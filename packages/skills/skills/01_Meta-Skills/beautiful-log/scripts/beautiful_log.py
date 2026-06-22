#!/usr/bin/env python3
"""Generate a clean HTML conversation log for NeuroClaw sessions.

This script keeps only direct User <-> NeuroClaw dialogue and filters
system/tool/internal traces when they are available in the transcript format.
"""

from __future__ import annotations

import argparse
import html
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

ALLOWED_ROLES = {"user", "assistant", "neuroclaw"}


def _normalize_role(raw_role: Optional[str]) -> str:
    if not raw_role:
        return ""
    role = str(raw_role).strip().lower()
    if role in {"assistant", "neuroclaw", "ai", "copilot"}:
        return "assistant"
    if role in {"user", "human"}:
        return "user"
    return role


def _extract_text(content: Any) -> str:
    if content is None:
        return ""

    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(p.strip() for p in parts if p and p.strip())

    if isinstance(content, dict):
        text = content.get("text") or content.get("content")
        if isinstance(text, str):
            return text.strip()

    return ""


def _extract_message(item: Dict[str, Any]) -> Optional[Dict[str, str]]:
    role = _normalize_role(item.get("role") or item.get("sender") or item.get("author"))
    if role not in ALLOWED_ROLES:
        return None

    text = _extract_text(item.get("content") or item.get("message") or item.get("text"))
    if not text:
        return None

    # Filter obvious internal/tool traces that may leak into assistant content.
    lowered = text.lower()
    blocked_markers = [
        "tool call",
        "read_file",
        "list_dir",
        "apply_patch",
        "internal reasoning",
        "skill.md",
        "trace id",
    ]
    if any(marker in lowered for marker in blocked_markers):
        return None

    timestamp = str(item.get("timestamp") or item.get("time") or "")
    return {"role": role, "content": text, "timestamp": timestamp}


def _load_json(path: Path) -> Iterable[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [obj for obj in data if isinstance(obj, dict)]

    if isinstance(data, dict):
        for key in ("messages", "conversation", "items", "chat"):
            value = data.get(key)
            if isinstance(value, list):
                return [obj for obj in value if isinstance(obj, dict)]

    return []


def _load_jsonl(path: Path) -> Iterable[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text:
            continue
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def _load_markdown(path: Path) -> Iterable[Dict[str, Any]]:
    messages: List[Dict[str, Any]] = []
    current_role = ""
    buffer: List[str] = []

    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.lower().startswith(("user:", "neuroclaw:", "assistant:")):
            if current_role and buffer:
                messages.append({"role": current_role, "content": "\n".join(buffer).strip()})
            head, body = stripped.split(":", 1)
            current_role = _normalize_role(head)
            buffer = [body.strip()] if body.strip() else []
        elif current_role:
            buffer.append(line)

    if current_role and buffer:
        messages.append({"role": current_role, "content": "\n".join(buffer).strip()})

    return messages


def load_messages(path: Path) -> List[Dict[str, str]]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        raw = _load_json(path)
    elif suffix == ".jsonl":
        raw = _load_jsonl(path)
    elif suffix in {".md", ".txt"}:
        raw = _load_markdown(path)
    else:
        raise ValueError(f"Unsupported input format: {suffix}")

    result: List[Dict[str, str]] = []
    for item in raw:
        normalized = _extract_message(item)
        if normalized is not None:
            result.append(normalized)
    return result


def render_html(messages: List[Dict[str, str]], title: str) -> str:
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")

    cards: List[str] = []
    for msg in messages:
        role = msg["role"]
        speaker = "User" if role == "user" else "NeuroClaw"
        css = "msg-user" if role == "user" else "msg-neuroclaw"
        timestamp = html.escape(msg["timestamp"]) if msg["timestamp"] else ""
        meta = f"<div class=\"meta\">{speaker}{(' · ' + timestamp) if timestamp else ''}</div>"
        body = html.escape(msg["content"]).replace("\n", "<br>")
        cards.append(f"<article class=\"msg {css}\">{meta}<div class=\"body\">{body}</div></article>")

    cards_html = "\n".join(cards) if cards else "<p class=\"empty\">No direct User/NeuroClaw dialogue found.</p>"

    return f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>{html.escape(title)}</title>
  <style>
    :root {{
      --bg: #f7f8fb;
      --panel: #ffffff;
      --text: #1f2430;
      --muted: #5a6475;
      --user-bg: #fff4de;
      --user-border: #f4c46a;
      --nc-bg: #e8f3ff;
      --nc-border: #8cb9ff;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: linear-gradient(180deg, #f3f6fb 0%, #f8fafc 100%);
      color: var(--text);
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      line-height: 1.55;
    }}
    .wrap {{
      max-width: 980px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }}
    .hero {{
      background: var(--panel);
      border: 1px solid #e7ebf3;
      border-radius: 14px;
      padding: 18px 20px;
      box-shadow: 0 8px 30px rgba(31, 36, 48, 0.06);
      margin-bottom: 18px;
    }}
    h1 {{ margin: 0 0 8px; font-size: 1.35rem; }}
    .sub {{ color: var(--muted); font-size: 0.94rem; }}
    .msg {{
      border-radius: 14px;
      border: 1px solid transparent;
      padding: 14px 16px;
      margin: 12px 0;
      box-shadow: 0 4px 14px rgba(20, 24, 34, 0.05);
    }}
    .msg-user {{ background: var(--user-bg); border-color: var(--user-border); }}
    .msg-neuroclaw {{ background: var(--nc-bg); border-color: var(--nc-border); }}
    .meta {{ font-size: 0.83rem; color: #3f4a5d; font-weight: 600; margin-bottom: 6px; }}
    .body {{ white-space: normal; word-break: break-word; }}
    .empty {{
      color: #6b7486;
      font-style: italic;
      background: #fff;
      border: 1px dashed #c8d2e5;
      border-radius: 10px;
      padding: 12px;
    }}
    footer {{
      margin-top: 22px;
      color: #667086;
      font-size: 0.82rem;
    }}
  </style>
</head>
<body>
  <main class=\"wrap\">
    <section class=\"hero\">
      <h1>{html.escape(title)}</h1>
      <div class=\"sub\">Beautiful dialogue log containing only direct User and NeuroClaw messages.</div>
    </section>
    {cards_html}
    <footer>Generated at {html.escape(generated_at)}.</footer>
  </main>
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a beautiful HTML log for NeuroClaw dialogue.")
    parser.add_argument("--input", required=True, help="Input transcript file (.json, .jsonl, .md, .txt)")
    parser.add_argument("--output", required=True, help="Output HTML path")
    parser.add_argument("--title", default="NeuroClaw Conversation Log", help="HTML page title")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")

    messages = load_messages(input_path)
    html_text = render_html(messages, args.title)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html_text, encoding="utf-8")

    print(f"Input: {input_path}")
    print(f"Output: {output_path}")
    print(f"Kept messages: {len(messages)}")


if __name__ == "__main__":
    main()
