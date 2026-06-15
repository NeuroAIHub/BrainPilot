#!/usr/bin/env bats

DIR="${BATS_TEST_DIRNAME}/.."
SCRIPT="$DIR/dispatch.sh"

setup() {
  TMP="$(mktemp -d)"
  cat > "$TMP/send.sh" <<EOF
#!/usr/bin/env bash
cat > "$TMP/sent.json"
EOF
  chmod +x "$TMP/send.sh"
  export LARK_NOTIFY_SEND_BIN="$TMP/send.sh"
}
teardown() { rm -rf "$TMP"; }

@test "issue_opened maps issue fields into card title with number" {
  export NOTIFY_KIND="issue_opened" REPO="NeuroAIHub/BrainPilot"
  export ISSUE_NUM="12" ISSUE_TITLE="登录崩溃" ISSUE_URL="https://x/issues/12" ISSUE_USER="alice"
  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  title="$(jq -r '.card.elements[0].text.content' "$TMP/sent.json")"
  echo "$title" | grep -q "#12 登录崩溃"
  echo "$title" | grep -q "alice"
  [ "$(jq -r '.card.elements[1].actions[0].url' "$TMP/sent.json")" = "https://x/issues/12" ]
}

@test "pr_comment uses comment fields and pr number" {
  export NOTIFY_KIND="pr_comment" REPO="r"
  export PR_NUM="7" ISSUE_TITLE="" PR_TITLE=""
  export ISSUE_NUM="7"
  export COMMENT_BODY="LGTM" COMMENT_URL="https://x/pull/7#c1" COMMENT_USER="bob"
  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  content="$(jq -r '.card.elements[0].text.content' "$TMP/sent.json")"
  echo "$content" | grep -q "LGTM"
  echo "$content" | grep -q "bob"
}

@test "review_approved uses review fields" {
  export NOTIFY_KIND="review_approved" REPO="r"
  export PR_NUM="7" PR_TITLE="加功能" PR_URL="https://x/pull/7"
  export REVIEW_BODY="nice" REVIEW_URL="https://x/pull/7#r1" REVIEW_USER="carol"
  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  content="$(jq -r '.card.elements[0].text.content' "$TMP/sent.json")"
  echo "$content" | grep -q "carol"
  [ "$(jq -r '.card.elements[1].actions[0].url' "$TMP/sent.json")" = "https://x/pull/7#r1" ]
}
