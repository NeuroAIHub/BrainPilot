#!/usr/bin/env bash
# 按 NOTIFY_KIND 从对应的 GitHub 事件环境变量里选出 TITLE/ACTOR/URL/BODY，
# 调 build-card.sh 生成卡片，再交给 send.sh 发送。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEND_BIN="${LARK_NOTIFY_SEND_BIN:-$HERE/send.sh}"

NOTIFY_KIND="${NOTIFY_KIND:?}"
REPO="${REPO:-}"

case "$NOTIFY_KIND" in
  issue_opened|issue_closed)
    NUM="${ISSUE_NUM:-}"; T="${ISSUE_TITLE:-}"; U="${ISSUE_URL:-}"; A="${ISSUE_USER:-}"; B=""
    ;;
  issue_comment|pr_comment)
    NUM="${ISSUE_NUM:-${PR_NUM:-}}"
    T="${ISSUE_TITLE:-${PR_TITLE:-}}"
    U="${COMMENT_URL:-}"; A="${COMMENT_USER:-}"; B="${COMMENT_BODY:-}"
    ;;
  pr_opened|pr_merged|pr_closed|pr_ready|review_requested)
    NUM="${PR_NUM:-}"; T="${PR_TITLE:-}"; U="${PR_URL:-}"; A="${PR_USER:-}"; B="${PR_BODY:-}"
    ;;
  review_approved|review_changes|review_commented)
    NUM="${PR_NUM:-}"; T="${PR_TITLE:-}"; U="${REVIEW_URL:-}"; A="${REVIEW_USER:-}"; B="${REVIEW_BODY:-}"
    ;;
  *) echo "dispatch: unknown NOTIFY_KIND $NOTIFY_KIND" >&2; exit 1 ;;
esac

TITLE="#${NUM} ${T}"

NOTIFY_KIND="$NOTIFY_KIND" TITLE="$TITLE" REPO="$REPO" ACTOR="$A" URL="$U" BODY="$B" \
  bash "$HERE/build-card.sh" | bash "$SEND_BIN"
