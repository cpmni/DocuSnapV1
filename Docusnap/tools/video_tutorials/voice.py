#!/usr/bin/env python3
r"""
voice.py — add the voice-over to a recorded tutorial from its narration.json.

    python voice.py "%USERPROFILE%\Desktop\Tutorials\teach-a-document.narration.json"
    python voice.py --all "%USERPROFILE%\Desktop\Tutorials"                 # every *.narration.json in the folder
    python voice.py x.narration.json --provider elevenlabs --voice <voice_id>   # needs ELEVENLABS_API_KEY
    python voice.py x.narration.json --provider openai --voice onyx             # needs OPENAI_API_KEY

For each line {start, end, text}: generate speech (cached by text+voice in out\voice\), measure it, and if it
runs more than 5 % past its window speed it up (ffmpeg atempo, capped at 1.25×) — never cut. Lines are placed
at their `start` (or just after the previous line if that one ran long), mixed onto one track the length of
the video, loudness-normalised for YouTube, and muxed onto the MP4 as AAC → <name>-final.mp4 next to the JSON.
Also writes <name>-voice.wav (the bare track) and prints a per-line report.

Providers
  edge        Microsoft Edge neural voices — free, no account, needs internet. `pip install edge-tts`.
              Voices: en-GB-RyanNeural (male, default), en-GB-SoniaNeural, en-GB-ThomasNeural, en-GB-LibbyNeural,
              en-US-GuyNeural, en-US-JennyNeural … (`edge-tts --list-voices`). --rate e.g. "+5%" / "-5%".
  elevenlabs  https://api.elevenlabs.io — ELEVENLABS_API_KEY; --voice = voice id; --model (default eleven_multilingual_v2).
  openai      https://api.openai.com/v1/audio/speech — OPENAI_API_KEY; --voice alloy|ash|coral|echo|fable|onyx|nova|sage|shimmer;
              --model (default gpt-4o-mini-tts); --instructions steers the delivery.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from scanfinder_video_runner import find_ffmpeg  # noqa: E402

# Use the Windows certificate store for TLS (Python's own bundle misses roots injected by AV/proxy TLS
# inspection → "CERTIFICATE_VERIFY_FAILED" against speech.platform.bing.com). Optional: `pip install truststore`.
try:
    import truststore  # noqa: E402

    truststore.inject_into_ssl()
except ImportError:
    pass

DEFAULT_VOICE = {"edge": "en-GB-RyanNeural", "elevenlabs": "", "openai": "onyx"}


def log(msg: str) -> None:
    print(msg, flush=True)


# ---- TTS providers ---------------------------------------------------------------------------------------------------
def tts_edge(text: str, out_mp3: str, voice: str, rate: str, **_) -> None:
    try:
        import asyncio
        import edge_tts
    except ImportError as e:
        raise SystemExit("edge provider needs `pip install edge-tts`") from e

    async def run():
        await edge_tts.Communicate(text, voice, rate=rate).save(out_mp3)

    asyncio.run(run())


def tts_elevenlabs(text: str, out_mp3: str, voice: str, model: str, **_) -> None:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key or not voice:
        raise SystemExit("elevenlabs provider needs ELEVENLABS_API_KEY and --voice <voice_id>")
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
        data=json.dumps({"text": text, "model_id": model or "eleven_multilingual_v2"}).encode(),
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(out_mp3, "wb") as fh:
        fh.write(resp.read())


def tts_openai(text: str, out_mp3: str, voice: str, model: str, instructions: str, **_) -> None:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise SystemExit("openai provider needs OPENAI_API_KEY")
    body = {"model": model or "gpt-4o-mini-tts", "voice": voice or "onyx", "input": text, "response_format": "mp3"}
    if instructions:
        body["instructions"] = instructions
    req = urllib.request.Request("https://api.openai.com/v1/audio/speech", data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(out_mp3, "wb") as fh:
        fh.write(resp.read())


PROVIDERS = {"edge": tts_edge, "elevenlabs": tts_elevenlabs, "openai": tts_openai}


# ---- audio helpers ---------------------------------------------------------------------------------------------------
def duration(ffmpeg: str, path: str) -> float:
    ffprobe = os.path.join(os.path.dirname(ffmpeg), "ffprobe.exe")
    out = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout.strip()
    return float(out or 0)


def run_ffmpeg(ffmpeg: str, args: list[str]) -> None:
    res = subprocess.run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error"] + args, capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit(f"ffmpeg failed: {res.stderr.strip()[-600:]}")


# ---- main per-video job ----------------------------------------------------------------------------------------------
def voice_video(narration_json: str, opts: argparse.Namespace) -> str:
    ffmpeg = find_ffmpeg(opts.ffmpeg)
    with open(narration_json, encoding="utf-8") as fh:
        nar = json.load(fh)
    folder = os.path.dirname(os.path.abspath(narration_json))
    name = os.path.basename(narration_json).replace(".narration.json", "")
    video = os.path.join(folder, nar.get("video") or name + ".mp4")
    if not os.path.isfile(video):
        raise SystemExit(f"video not found next to the JSON: {video}")
    total = float(nar.get("total_sec") or duration(ffmpeg, video))
    cache = os.path.join(opts.cache, name)
    os.makedirs(cache, exist_ok=True)
    voice = opts.voice or DEFAULT_VOICE[opts.provider]
    tts = PROVIDERS[opts.provider]
    log(f"\n{name}: {len(nar['lines'])} lines · video {total:.1f}s · {opts.provider} {voice}")

    placed: list[tuple[str, float]] = []   # (clip path, offset seconds)
    cursor = 0.0
    for ln in nar["lines"]:
        text = (ln.get("text") or "").strip()
        if not text:
            continue
        key = hashlib.sha1(f"{opts.provider}|{voice}|{opts.rate}|{opts.model}|{opts.instructions}|{text}".encode()).hexdigest()[:12]
        raw = os.path.join(cache, f"{ln['id']}_{key}.mp3")
        if not os.path.isfile(raw) or os.path.getsize(raw) == 0:
            for attempt in range(1, 5):   # edge-tts occasionally returns "No audio was received" — transient
                try:
                    tts(text, raw, voice=voice, rate=opts.rate, model=opts.model, instructions=opts.instructions)
                    if os.path.getsize(raw) > 0:
                        break
                except SystemExit:
                    raise
                except Exception as e:  # noqa: BLE001
                    if attempt == 4:
                        raise
                    log(f"  {ln['id']}: TTS attempt {attempt} failed ({type(e).__name__}) — retrying")
                    import time
                    time.sleep(2 * attempt)
        dur = duration(ffmpeg, raw)
        window = max(float(ln["end"]) - float(ln["start"]), 0.5)
        clip = raw
        note = ""
        if dur > window * (1 + opts.tolerance):
            tempo = min(dur / window, opts.max_tempo)
            clip = os.path.join(cache, f"{ln['id']}_{key}_x{tempo:.2f}.wav")
            if not os.path.isfile(clip):
                run_ffmpeg(ffmpeg, ["-i", raw, "-filter:a", f"atempo={tempo:.3f}", clip])
            new = duration(ffmpeg, clip)
            note = f"  ↑{tempo:.2f}× → {new:.1f}s" + ("" if new <= window * (1 + opts.tolerance) + 0.3 else "  ⚠ still over")
            dur = new
        start = max(float(ln["start"]) + opts.offset, cursor + opts.gap)
        if start > float(ln["start"]) + 1.0:
            note += f"  ⚠ pushed +{start - float(ln['start']):.1f}s by the previous line"
        placed.append((clip, start))
        cursor = start + dur
        log(f"  {ln['id']:<22} {float(ln['start']):6.1f}s  window {window:5.1f}s  speech {dur:5.1f}s{note}")

    # one track: every clip delayed to its offset, mixed, padded to the video length, normalised for YouTube
    inputs, filters, tags = [], [], []
    for i, (clip, off) in enumerate(placed):
        inputs += ["-i", clip]
        ms = int(round(off * 1000))
        filters.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=mono,adelay={ms}|{ms}[a{i}]")
        tags.append(f"[a{i}]")
    filters.append(f"{''.join(tags)}amix=inputs={len(placed)}:normalize=0:dropout_transition=0,"
                   f"apad,atrim=0:{total:.3f},loudnorm=I=-16:TP=-1.5:LRA=11[mix]")
    track = os.path.join(folder, name + "-voice.wav")
    run_ffmpeg(ffmpeg, inputs + ["-filter_complex", ";".join(filters), "-map", "[mix]", "-ar", "48000", track])
    final = os.path.join(folder, name + "-final.mp4")
    run_ffmpeg(ffmpeg, ["-i", video, "-i", track, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
                        "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", final])
    log(f"  → {final}  ({duration(ffmpeg, final):.1f}s)")
    return final


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Generate the voice-over for a tutorial from its narration.json and mux it.")
    ap.add_argument("narration", nargs="?", help="path to <name>.narration.json")
    ap.add_argument("--all", metavar="DIR", help="process every *.narration.json in DIR")
    ap.add_argument("--provider", choices=sorted(PROVIDERS), default="edge")
    ap.add_argument("--voice", default=None, help="voice name/id (edge default en-GB-RyanNeural)")
    ap.add_argument("--rate", default="+10%", help="edge only: speaking rate (default +10%% — the lines were sized at ~2.5 words/s, "
                                                  "Ryan's natural pace is a little slower); e.g. +0%% or +15%%")
    ap.add_argument("--tolerance", type=float, default=0.12,
                    help="a line may overrun its window by this fraction before being sped up (default 0.12); the next "
                         "line simply starts a little later")
    ap.add_argument("--model", default="", help="elevenlabs/openai model id")
    ap.add_argument("--instructions", default="Calm, friendly, clear instructional narration for a software tutorial.",
                    help="openai only: delivery instructions")
    ap.add_argument("--offset", type=float, default=0.15, help="seconds added to every start (breathing room)")
    ap.add_argument("--gap", type=float, default=0.25, help="minimum silence between lines when one runs long")
    ap.add_argument("--max-tempo", type=float, default=1.2, help="cap for speeding up an over-long line")
    ap.add_argument("--cache", default=os.path.join(HERE, "out", "voice"), help="clip cache folder")
    ap.add_argument("--ffmpeg", default=None)
    opts = ap.parse_args(argv)
    if not opts.narration and not opts.all:
        ap.error("give a narration.json or --all DIR")
    files = sorted(glob.glob(os.path.join(opts.all, "*.narration.json"))) if opts.all else [opts.narration]
    if not files:
        raise SystemExit("no *.narration.json found")
    for f in files:
        voice_video(f, opts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
