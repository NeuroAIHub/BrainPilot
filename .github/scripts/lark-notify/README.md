# Lark Notify — GitHub Issue/PR → 飞书群

事件驱动：issue/PR 变动时，GitHub Actions 构造飞书交互卡片，POST 到开发者小群的自定义机器人 webhook。

## 一次性配置

1. 飞书目标群 → 设置 → 群机器人 → 添加「自定义机器人」→ 复制 **Webhook 地址**。
   - 可选：开启「签名校验」，复制其 **密钥**。
2. GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret：
   - `LARK_WEBHOOK_URL`（必填）= 上面的 Webhook 地址
   - `LARK_WEBHOOK_SECRET`（仅当开启签名校验时填）= 上面的密钥

> workflow 文件只引用 `${{ secrets.* }}`，真实地址/密钥只存 GitHub Secret，不进 git。
> 通知 workflow（`lark-notify.yml`）必须在仓库**默认分支 main** 上才会接收 issue/PR 事件。

## 覆盖的事件（12 类）

Issue：opened / closed / 评论；
PR：opened / merged / closed(未合并) / 转 ready / 请求评审 / 评论；
评审提交：通过 / 请求修改 / 评论。

评论/正文在卡片中显示约 200 字摘要（超出截断）。

## 本地测试脚本

```bash
brew install bats-core jq      # macOS
bats .github/scripts/lark-notify/test/
```

CI 会在 PR / push 改动脚本或 workflow 时自动跑这些测试（见 `lark-notify-test.yml`）。

## 手动冒烟（合并到 main 后）

新建测试 issue → 看群里出「🟢 新 Issue」；评论 / 关闭依次验证；
提 draft PR → 转 ready → 请求评审 → approve → 合并，逐一核对卡片。
验证完删除测试 issue/PR。Actions 页面可看每次运行日志，失败 step 标红。

## 安全与开源

PR 事件用 `pull_request_target`（在 base 仓上下文运行、可拿 secret），使仓库**开源后外部 fork PR 也能推群**。这是安全的，因为本 workflow：
- 绝不 checkout / 执行 PR 的代码，只读 `github.event.pull_request.*` 元数据；
- PR 标题/正文只作为数据经环境变量 + `jq --arg` 进卡片，绝不拼进 shell；
- `permissions` 只有 `contents: read`。

### 转 public 前 checklist

- [ ] `git log -p | grep -iE 'open.feishu|larksuite|/bot/v2/hook/'` 确认历史无真实 webhook 残留
- [ ] 确认 secret 已配置、workflow 仅含 `${{ secrets.* }}` 占位引用
- [ ] 确认 PR 事件用 `pull_request_target`、**无 checkout PR head 代码的步骤**、`permissions` 最小
- [ ] （可选）飞书侧已开签名校验
