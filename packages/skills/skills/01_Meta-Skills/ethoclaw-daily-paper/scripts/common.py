#!/usr/bin/env python3
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path


def parse_simple_yaml(path: Path):
    data = {}
    current_key = None
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if line.startswith("  - ") and current_key:
            data.setdefault(current_key, []).append(stripped[2:].strip())
            continue
        if ":" in line and not line.startswith("  "):
            key, value = line.split(":", 1)
            current_key = key.strip()
            value = value.strip()
            if not value:
                data[current_key] = []
            else:
                if value.isdigit():
                    data[current_key] = int(value)
                else:
                    data[current_key] = value.strip('"').strip("'")
    return data


def load_config(path_str: str | None):
    if not path_str:
        return {}
    path = Path(path_str)
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    return parse_simple_yaml(path)


def normalize(text_value: str):
    return re.sub(r"\s+", " ", (text_value or "")).strip().lower()


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, payload):
    output_path = Path(path).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path


def responses_endpoint(base_url: str | None = None):
    base = (base_url or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    return base if base.endswith("/responses") else base + "/responses"


def extract_output_text(response_payload: dict):
    chunks = []
    for item in response_payload.get("output", []):
        if item.get("type") != "message":
            continue
        for part in item.get("content", []):
            if part.get("type") == "output_text" and part.get("text"):
                chunks.append(part["text"])
    return "".join(chunks).strip()


def call_openai_structured(
    *,
    model: str,
    instructions: str,
    input_text: str,
    schema_name: str,
    schema: dict,
    api_key: str | None = None,
    timeout: int = 180,
    reasoning_effort: str = "low",
    verbosity: str = "low",
):
    api_key = api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("Missing OPENAI_API_KEY. Set it before running the LLM digest script.")

    payload = {
        "model": model,
        "instructions": instructions,
        "input": input_text,
        "store": False,
        "text": {
            "format": {
                "type": "json_schema",
                "name": schema_name,
                "strict": True,
                "schema": schema,
            },
            "verbosity": verbosity,
        },
        "reasoning": {
            "effort": reasoning_effort,
        },
    }

    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        responses_endpoint(),
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"OpenAI API request failed with HTTP {exc.code}: {details}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"OpenAI API request failed: {exc}") from exc

    output_text = extract_output_text(response_payload)
    if not output_text:
        raise SystemExit("OpenAI API returned no text output.")

    try:
        return json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Model output was not valid JSON: {output_text}") from exc
