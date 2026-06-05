"""
extraction/llm.py
-----------------
Stage 3 extraction — Phi-3 Mini via Ollama.
Only called for fields not already found by keyword or anchor stages.
Smaller, faster model — loads in ~5 seconds on a 4GB GPU.
"""

import json
import time
import requests


MODEL_NAME = "phi3:mini"
DEFAULT_URL = "http://127.0.0.1:11434/api/generate"


def warmup(ollama_url: str = DEFAULT_URL, model: str = MODEL_NAME) -> bool:
    """
    Send a tiny request to load the model into GPU memory.
    Call once before processing a batch.
    Returns True if model is ready.
    """
    try:
        r = requests.post(
            ollama_url,
            json={
                "model":   model,
                "prompt":  "Reply with the word ready.",
                "stream":  False,
                "options": {"temperature": 0.0, "num_predict": 3},
            },
            timeout=300,
        )
        return r.status_code == 200
    except Exception:
        return False


def extract_missing_fields(
    ocr_text:         str,
    filename:         str,
    fields:           list[dict],
    already_found:    dict,
    hints:            list[dict],
    document_type:    str | None,
    supplier_name:    str | None,
    ollama_url:       str = DEFAULT_URL,
    model:            str = MODEL_NAME,
) -> dict:
    """
    Extract only the fields NOT already found by keyword/anchor stages.
    Returns dict of {field_key: {"value": ..., "confidence": int, "method": "llm"}}
    """
    missing = [f for f in fields if f["key"] not in already_found]
    if not missing:
        return {}

    prompt = _build_prompt(
        ocr_text, filename, missing, hints,
        document_type, supplier_name, already_found
    )

    for attempt in range(3):
        try:
            r = requests.post(
                ollama_url,
                json={
                    "model":   model,
                    "prompt":  prompt,
                    "stream":  False,
                    "options": {"temperature": 0.0, "num_predict": 1000},
                },
                timeout=300,
            )
            r.raise_for_status()
            raw = r.json().get("response", "").strip()
            return _parse_response(raw, missing)

        except Exception as e:
            if attempt < 2:
                time.sleep(5)
            else:
                return {f["key"]: {"value": None, "confidence": 0,
                                   "method": "llm_failed"} for f in missing}

    return {}


def _build_prompt(ocr_text, filename, fields, hints,
                  document_type, supplier_name, already_found):
    """Build a focused prompt — only asks about missing fields."""

    fields_desc = "\n".join(
        f'  "{f["key"]}": {{"value": <text or null>, "confidence": <0-100>}}'
        for f in fields
    )

    # Inject what we already know as context
    known_section = ""
    if already_found or supplier_name or document_type:
        known = []
        if document_type:
            known.append(f"Document type: {document_type}")
        if supplier_name:
            known.append(f"Supplier: {supplier_name}")
        for k, v in already_found.items():
            if v.get("value"):
                known.append(f"{k}: {v['value']} (already confirmed)")
        if known:
            known_section = "\nAlready extracted:\n" + "\n".join(known) + "\n"

    # Inject learned hints
    hints_section = ""
    if hints:
        relevant = [h for h in hints[:15] if h.get("hint_value")]
        if relevant:
            lines = ["=== LEARNED FROM PREVIOUS DOCUMENTS ==="]
            if supplier_name:
                lines.append(f"Supplier: {supplier_name}")
            for h in relevant:
                lines.append(
                    f"  {h['field_key']}: \"{h['hint_value']}\""
                    f" (confirmed {h.get('usage_count', 1)} times)"
                )
            lines.append("Use these as strong hints if matching values appear in the text.")
            lines.append("=== END HINTS ===")
            hints_section = "\n" + "\n".join(lines) + "\n"

    return f"""<|user|>
You are extracting specific fields from a scanned document: "{filename}".
{known_section}{hints_section}
Extract ONLY these missing fields. Return ONLY valid JSON — no markdown, no explanation.
Use null for fields not found. Confidence 0-100 (100=certain).

Fields needed:
{{
{fields_desc}
}}

OCR Text:
---
{ocr_text[:5000]}
---
<|end|>
<|assistant|>"""


def _parse_response(raw: str, fields: list[dict]) -> dict:
    """Parse LLM JSON response into extraction dict."""
    # Strip markdown fences
    if "```" in raw:
        for part in raw.split("```"):
            part = part.strip().lstrip("json").strip()
            if part.startswith("{"):
                raw = part
                break

    start, end = raw.find("{"), raw.rfind("}") + 1
    if start != -1 and end > start:
        raw = raw[start:end]

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {f["key"]: {"value": None, "confidence": 0, "method": "llm"}
                for f in fields}

    results = {}
    for f in fields:
        key = f["key"]
        raw_field = parsed.get(key, {})
        if isinstance(raw_field, dict):
            results[key] = {
                "value":      raw_field.get("value"),
                "confidence": int(raw_field.get("confidence", 40)),
                "method":     "llm",
            }
        else:
            results[key] = {
                "value":      raw_field,
                "confidence": 40,
                "method":     "llm",
            }
    return results
