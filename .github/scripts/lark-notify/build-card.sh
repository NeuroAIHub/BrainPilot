#!/usr/bin/env bash
# 读环境变量，输出飞书 interactive 卡片 JSON 到 stdout。纯函数，无网络。
set -euo pipefail

NOTIFY_KIND="${NOTIFY_KIND:?NOTIFY_KIND required}"
TITLE="${TITLE:-}"
REPO="${REPO:-}"
ACTOR="${ACTOR:-}"
URL="${URL:-}"
BODY="${BODY:-}"

# 事件类型 → 颜色 + 中文标题
case "$NOTIFY_KIND" in
  issue_opened)       TEMPLATE="green";  HEAD="🟢 新 Issue" ;;
  issue_closed)       TEMPLATE="red";    HEAD="🔴 Issue 已关闭" ;;
  issue_comment)      TEMPLATE="blue";   HEAD="🔵 Issue 新评论" ;;
  pr_comment)         TEMPLATE="blue";   HEAD="🔵 PR 新评论" ;;
  pr_opened)          TEMPLATE="green";  HEAD="🟢 新 PR" ;;
  pr_merged)          TEMPLATE="green";  HEAD="🟢 PR 已合并" ;;
  pr_closed)          TEMPLATE="red";    HEAD="🔴 PR 已关闭(未合并)" ;;
  pr_ready)           TEMPLATE="blue";   HEAD="🔵 PR 转为可评审" ;;
  review_requested)   TEMPLATE="blue";   HEAD="🔵 请求评审" ;;
  review_approved)    TEMPLATE="green";  HEAD="🟢 评审已通过" ;;
  review_changes)     TEMPLATE="red";    HEAD="🔴 评审请求修改" ;;
  review_commented)   TEMPLATE="yellow"; HEAD="🟡 评审评论" ;;
  *) echo "unknown NOTIFY_KIND: $NOTIFY_KIND" >&2; exit 1 ;;
esac

# 正文摘要：超过 200 字符时截断为 199 字 + …；否则原样。先去掉 \r
SUMMARY=""
if [ -n "$BODY" ]; then
  SUMMARY="$(BODY="$BODY" jq -rn '
    (env.BODY | gsub("\r";"")) as $b
    | if ($b | length) > 200 then ($b[0:199] + "…") else $b end')"
fi

jq -n \
  --arg template "$TEMPLATE" \
  --arg head "$HEAD" \
  --arg title "$TITLE" \
  --arg repo "$REPO" \
  --arg actor "$ACTOR" \
  --arg url "$URL" \
  --arg summary "$SUMMARY" \
  '
  # 转义标题中的 * 以免破坏 lark_md 粗体
  ($title | gsub("\\*"; "\\*")) as $safetitle
  | ( "**" + $safetitle + "**\n仓库：" + $repo + "\n作者：" + $actor ) as $base
  | ( if $summary == "" then $base
      else $base + "\n┄┄┄┄┄┄┄┄┄┄\n" + $summary end ) as $body
  | {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: $template,
        title: { tag: "plain_text", content: $head }
      },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: $body } },
        { tag: "action", actions: [
          { tag: "button", text: { tag: "plain_text", content: "在 GitHub 查看" },
            url: $url, type: "primary" } ] }
      ]
    }
  }'
