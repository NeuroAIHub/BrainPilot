#!/usr/bin/env bats

SCRIPT="${BATS_TEST_DIRNAME}/../build-card.sh"

@test "issue opened: green header" {
  export NOTIFY_KIND="issue_opened"
  export TITLE="#12 修复登录崩溃"
  export REPO="NeuroAIHub/BrainPilot"
  export ACTOR="HaoxuanLiTHUAI"
  export URL="https://github.com/NeuroAIHub/BrainPilot/issues/12"
  export BODY=""
  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e . >/dev/null
  [ "$(echo "$output" | jq -r '.msg_type')" = "interactive" ]
  [ "$(echo "$output" | jq -r '.card.header.template')" = "green" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🟢 新 Issue" ]
}

@test "issue closed: red header" {
  export NOTIFY_KIND="issue_closed" TITLE="#1 x" REPO="r" ACTOR="a" URL="u" BODY=""
  run bash "$SCRIPT"
  [ "$(echo "$output" | jq -r '.card.header.template')" = "red" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🔴 Issue 已关闭" ]
}

@test "issue comment: blue header" {
  export NOTIFY_KIND="issue_comment" TITLE="#1 x" REPO="r" ACTOR="a" URL="u" BODY="hi"
  run bash "$SCRIPT"
  [ "$(echo "$output" | jq -r '.card.header.template')" = "blue" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🔵 Issue 新评论" ]
}

@test "pr comment: blue header" {
  export NOTIFY_KIND="pr_comment" TITLE="#2 y" REPO="r" ACTOR="a" URL="u" BODY="hi"
  run bash "$SCRIPT"
  [ "$(echo "$output" | jq -r '.card.header.template')" = "blue" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🔵 PR 新评论" ]
}

@test "pr opened: green" {
  export NOTIFY_KIND="pr_opened" TITLE="#2 y" REPO="r" ACTOR="a" URL="u" BODY=""
  run bash "$SCRIPT"
  [ "$(echo "$output" | jq -r '.card.header.template')" = "green" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🟢 新 PR" ]
}

@test "pr merged: green" {
  export NOTIFY_KIND="pr_merged" TITLE="#2 y" REPO="r" ACTOR="a" URL="u" BODY=""
  run bash "$SCRIPT"
  [ "$(echo "$output" | jq -r '.card.header.template')" = "green" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🟢 PR 已合并" ]
}

@test "pr closed unmerged: red" {
  export NOTIFY_KIND="pr_closed" TITLE="#2 y" REPO="r" ACTOR="a" URL="u" BODY=""
  run bash "$SCRIPT"
  [ "$(echo "$output" | jq -r '.card.header.template')" = "red" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🔴 PR 已关闭(未合并)" ]
}

@test "pr ready for review: blue" {
  export NOTIFY_KIND="pr_ready" TITLE="#2 y" REPO="r" ACTOR="a" URL="u" BODY=""
  run bash "$SCRIPT"
  [ "$(echo "$output" | jq -r '.card.header.template')" = "blue" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🔵 PR 转为可评审" ]
}

@test "review requested: blue" {
  export NOTIFY_KIND="review_requested" TITLE="#2 y" REPO="r" ACTOR="a" URL="u" BODY=""
  run bash "$SCRIPT"
  [ "$(echo "$output" | jq -r '.card.header.template')" = "blue" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🔵 请求评审" ]
}

@test "review approved: green" {
  export NOTIFY_KIND="review_approved" TITLE="#2 y" REPO="r" ACTOR="a" URL="u" BODY=""
  run bash "$SCRIPT"
  [ "$(echo "$output" | jq -r '.card.header.template')" = "green" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🟢 评审已通过" ]
}

@test "review changes_requested: red" {
  export NOTIFY_KIND="review_changes" TITLE="#2 y" REPO="r" ACTOR="a" URL="u" BODY=""
  run bash "$SCRIPT"
  [ "$(echo "$output" | jq -r '.card.header.template')" = "red" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🔴 评审请求修改" ]
}

@test "review commented: yellow" {
  export NOTIFY_KIND="review_commented" TITLE="#2 y" REPO="r" ACTOR="a" URL="u" BODY=""
  run bash "$SCRIPT"
  [ "$(echo "$output" | jq -r '.card.header.template')" = "yellow" ]
  [ "$(echo "$output" | jq -r '.card.header.title.content')" = "🟡 评审评论" ]
}

@test "body present: appended into content" {
  export NOTIFY_KIND="issue_comment" TITLE="#1 x" REPO="r" ACTOR="a" URL="u" BODY="这是一条评论"
  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  content="$(echo "$output" | jq -r '.card.elements[0].text.content')"
  echo "$content" | grep -q "这是一条评论"
}

@test "body empty: no separator line" {
  export NOTIFY_KIND="pr_opened" TITLE="#2 y" REPO="r" ACTOR="a" URL="u" BODY=""
  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  content="$(echo "$output" | jq -r '.card.elements[0].text.content')"
  ! echo "$content" | grep -q "┄"
}

@test "body over 200 chars: summary is exactly 200 chars ending in ellipsis" {
  long="$(printf '中%.0s' {1..300})"
  export NOTIFY_KIND="issue_comment" TITLE="#1 x" REPO="r" ACTOR="a" URL="u" BODY="$long"
  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  content="$(echo "$output" | jq -r '.card.elements[0].text.content')"
  # 取分隔线之后的摘要部分（非贪婪匹配完整 10 字符分隔符 + 换行）
  summary="${content#*┄┄┄┄┄┄┄┄┄┄$'\n'}"
  # 摘要必须以省略号结尾
  [ "${summary: -1}" = "…" ]
  # 摘要 unicode 字符数必须恰好 200（199 正文 + …）
  len="$(printf '%s' "$summary" | jq -Rs 'length')"
  [ "$len" -eq 200 ]
}

@test "title with asterisks: escaped so bold not broken" {
  export NOTIFY_KIND="issue_opened" TITLE="#5 fix **bold** and *italic*" REPO="r" ACTOR="a" URL="u" BODY=""
  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e . >/dev/null
  content="$(echo "$output" | jq -r '.card.elements[0].text.content')"
  # raw asterisks from the title must be backslash-escaped in the output
  echo "$content" | grep -q 'fix \\\*\\\*bold\\\*\\\*'
}
