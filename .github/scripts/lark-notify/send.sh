#!/usr/bin/env bash
# 从 stdin 读卡片 JSON，按需签名，POST 到飞书自定义机器人。失败退出非 0。
set -euo pipefail

URL="${LARK_WEBHOOK_URL:?LARK_WEBHOOK_URL required}"
SECRET="${LARK_WEBHOOK_SECRET:-}"

CARD_JSON="$(cat)"

if [ -n "$SECRET" ]; then
  TS="$(date +%s)"
  # 飞书签名：HMAC-SHA256，key = "<timestamp>\n<secret>"，data 为空，结果 base64
  STRING_TO_SIGN="${TS}"$'\n'"${SECRET}"
  SIGN="$(printf '%s' "" | openssl dgst -sha256 -hmac "$STRING_TO_SIGN" -binary | base64)"
  PAYLOAD="$(jq -n --arg ts "$TS" --arg sign "$SIGN" --argjson card "$CARD_JSON" \
    '$card + { timestamp: $ts, sign: $sign }')"
else
  PAYLOAD="$CARD_JSON"
fi

REQ_BODY_FILE="$(mktemp)"
trap 'rm -f "$REQ_BODY_FILE"' EXIT
printf '%s' "$PAYLOAD" > "$REQ_BODY_FILE"

RESP="$(curl -sS -m 15 -X POST "$URL" \
  -H 'Content-Type: application/json' \
  --data-binary "@$REQ_BODY_FILE")"

printf '飞书响应: %s\n' "${RESP}" >&2
if ! CODE="$(printf '%s' "$RESP" | jq -r '.code // .StatusCode // "missing"' 2>/dev/null)"; then
  echo "推送失败：响应非合法 JSON: ${RESP}" >&2
  exit 1
fi
if [ "$CODE" != "0" ]; then
  echo "推送失败，code=${CODE}，响应: ${RESP}" >&2
  exit 1
fi
