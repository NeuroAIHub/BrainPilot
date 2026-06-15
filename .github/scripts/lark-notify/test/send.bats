#!/usr/bin/env bats

SCRIPT="${BATS_TEST_DIRNAME}/../send.sh"

setup() {
  TMP="$(mktemp -d)"
  cat > "$TMP/curl" <<'EOF'
#!/usr/bin/env bash
echo "$@" >> "$ARGS_FILE"
prev=""
for a in "$@"; do
  case "$prev" in
    --data|--data-binary|-d)
      f="${a#@}"; [ -f "$f" ] && cat "$f" > "$BODY_FILE" ;;
  esac
  prev="$a"
done
echo '{"code":0,"msg":"success"}'
EOF
  chmod +x "$TMP/curl"
  export PATH="$TMP:$PATH"
  export ARGS_FILE="$TMP/args" BODY_FILE="$TMP/body"
  : > "$ARGS_FILE"; : > "$BODY_FILE"
}

teardown() { rm -rf "$TMP"; }

@test "no secret: body has no timestamp or sign, has card" {
  export LARK_WEBHOOK_URL="https://example.invalid/hook"
  unset LARK_WEBHOOK_SECRET || true
  run bash -c 'echo '\''{"msg_type":"interactive","card":{"x":1}}'\'' | bash "'"$SCRIPT"'"'
  [ "$status" -eq 0 ]
  run cat "$BODY_FILE"
  [ "$(echo "$output" | jq -r '.timestamp // "none"')" = "none" ]
  [ "$(echo "$output" | jq -r '.sign // "none"')" = "none" ]
  [ "$(echo "$output" | jq -r '.msg_type')" = "interactive" ]
}

@test "with secret: body has timestamp and base64 sign" {
  export LARK_WEBHOOK_URL="https://example.invalid/hook"
  export LARK_WEBHOOK_SECRET="mysecret"
  run bash -c 'echo '\''{"msg_type":"interactive","card":{"x":1}}'\'' | bash "'"$SCRIPT"'"'
  [ "$status" -eq 0 ]
  run cat "$BODY_FILE"
  ts="$(echo "$output" | jq -r '.timestamp')"
  sign="$(echo "$output" | jq -r '.sign')"
  [ -n "$ts" ] && [ "$ts" != "null" ]
  [ -n "$sign" ] && [ "$sign" != "null" ]
  echo "$sign" | base64 -d >/dev/null 2>&1
}

@test "posts to configured URL with json content-type" {
  export LARK_WEBHOOK_URL="https://example.invalid/hook"
  unset LARK_WEBHOOK_SECRET || true
  run bash -c 'echo '\''{"msg_type":"interactive","card":{}}'\'' | bash "'"$SCRIPT"'"'
  [ "$status" -eq 0 ]
  grep -q "https://example.invalid/hook" "$ARGS_FILE"
  grep -q "Content-Type: application/json" "$ARGS_FILE"
}

@test "non-zero business code: exits 1" {
  # override the mock curl to return a failure code
  cat > "$TMP/curl" <<'EOF'
#!/usr/bin/env bash
echo '{"code":19021,"msg":"sign match fail"}'
EOF
  chmod +x "$TMP/curl"
  export LARK_WEBHOOK_URL="https://example.invalid/hook"
  unset LARK_WEBHOOK_SECRET || true
  run bash -c 'echo '\''{"msg_type":"interactive","card":{}}'\'' | bash "'"$SCRIPT"'"'
  [ "$status" -eq 1 ]
}
