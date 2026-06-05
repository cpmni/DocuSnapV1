#!/usr/bin/env python3
"""
ollama_manager.py
-----------------
Handles Ollama detection, status checking, and model availability.
Called by Electron to check if AI features are available.
Returns JSON status to stdout.
"""

import sys
import json
import argparse
import subprocess
import urllib.request
import urllib.error


OLLAMA_URL  = "http://127.0.0.1:11434"
PHI3_MODEL  = "phi3:mini"


def check_ollama_running() -> bool:
    try:
        req = urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=3)
        return req.status == 200
    except Exception:
        return False


def check_model_available(model: str = PHI3_MODEL) -> bool:
    try:
        req = urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=3)
        data = json.loads(req.read())
        models = [m["name"] for m in data.get("models", [])]
        base = model.split(":")[0]
        return any(model == m or base == m.split(":")[0] for m in models)
    except Exception:
        return False


def get_status() -> dict:
    running = check_ollama_running()
    if not running:
        return {
            "ollama_running":   False,
            "model_available":  False,
            "ai_ready":         False,
            "model":            PHI3_MODEL,
        }
    model_ok = check_model_available(PHI3_MODEL)
    return {
        "ollama_running":   True,
        "model_available":  model_ok,
        "ai_ready":         model_ok,
        "model":            PHI3_MODEL,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", default="status",
                        choices=["status", "pull-model"])
    parser.add_argument("--model", default=PHI3_MODEL)
    args = parser.parse_args()

    if args.action == "status":
        print(json.dumps(get_status()), flush=True)

    elif args.action == "pull-model":
        # Stream pull progress back as JSON lines
        if not check_ollama_running():
            print(json.dumps({"error": "Ollama is not running"}), flush=True)
            return

        try:
            import requests
            resp = requests.post(
                f"{OLLAMA_URL}/api/pull",
                json={"name": args.model, "stream": True},
                stream=True,
                timeout=3600,
            )
            for line in resp.iter_lines():
                if line:
                    try:
                        data = json.loads(line)
                        print(json.dumps({
                            "status":    data.get("status", ""),
                            "completed": data.get("completed"),
                            "total":     data.get("total"),
                        }), flush=True)
                    except Exception:
                        pass
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
