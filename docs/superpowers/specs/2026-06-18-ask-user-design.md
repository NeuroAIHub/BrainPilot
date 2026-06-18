# ask_user — 设计文档

**日期**: 2026-06-18
**状态**: 已确认设计,待实现
**作用域**: 让 principal agent 能主动向终端用户提问并阻塞等待回答,再继续当前 turn。

---

## 1. 背景与问题

BrainPilot 的 agent(基于 Pi SDK)目前是**单向回合制**:用户发消息 → `agent.prompt()` 一口气把整个 turn 跑到底 → 回消息。agent 在 turn 中途**无法**停下来向终端用户提问并等待输入。

但这个功能其实**做了一半**——协议层和前端已就绪,缺的是 runtime 一侧的接线:

**已实现(无需改动):**
- 协议:`UserInputRequestEventSchema` / `UserInputResponseEventSchema`(`packages/protocol/src/events.ts:341-367`),已纳入 `AgUiEventSchema` union(行 409-410)。
- 前端:`AskUserCard.tsx` 渲染问题卡片;`respondToInput()` 把回答 POST 回去(`packages/web/src/utils/api.ts:404-423`);`newUiEvents.ts` / `messageReducer.ts` 消费 `user_input_request`。

**缺失(本设计补齐):**
1. runtime 没有 `ask_user` 工具暴露给 Pi。
2. runtime 不发射 `user_input_request` 事件(`ev` 无对应 builder)。
3. runtime 没有按 `request_id` 恢复挂起调用的机制。
4. 前端把回答 POST 到 `/sessions/:id/messages`,body 形如 `{type, session_id, request_id, answer}` ——**没有 `content` 字段**,会被 `SendMessageRequestSchema`(只认 `content`)挡成 400(`packages/protocol/src/http.ts:119-137`、`packages/runtime/src/server.ts:73-83`)。

---

## 2. 核心机制

`ask_user` 工具的 `execute` 内 `await` 一个**挂起的 deferred promise** → 由于 Pi 与 mock 两条路径都是 `await tool.execute(args)`(`packages/runtime/src/mock-agent.ts:100`),turn 自然停在这里;server 收到回答后按 `request_id` resolve 该 deferred → `execute` 返回 → turn 继续。

无需新增 status 枚举、无需改状态机:等待期间 `status` 保持 `running`,"在等你"这一语义完全靠已实现的 `user_input_request` 事件 → `AskUserCard` 表达。

---

## 3. 已确认决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 谁能调用 ask_user | **仅 principal** | 符合"只有 principal 面向用户"的现有架构;专家需要信息时走 `send_message` 让 principal 转问。语义最干净,实现最小。 |
| 等待期间 session 状态 | `status` 保持 **running**,事件驱动 UI | 不动 status 枚举和状态机;与前端已实现的 `AskUserCard` 天然契合。 |
| 超时 | **不超时**(无限等) | 用户离开再回来仍能回答。`timeout_sec` 作为协议可选字段保留,本版**不实现**定时器。 |
| 取消 | `interrupt` 主动 **reject** 挂起项 | 纯 `await deferred` 未必被 `agent.abort()` 中断,故 `interrupt` 必须显式 reject 该 session 所有 `pendingInputs`,让 await 抛错、turn 干净结束。 |
| 回答接收入口 | **复用 `/messages`** | 前端零改动;放宽 schema 后在 server handler 内按 `type` 分流。 |
| 挂起登记表归属 | `SessionEntry.pendingInputs: Map`,经 `ToolDeps` 回调访问 | 仿现有 `ensureAgent`/`destroyAgent` 的委托模式(`ToolDeps` 里无原始对象,只有回调)。登记表逻辑极薄(Map + Deferred),内联进 `SessionEntry` 与 `mailbox`/`trace`/`agents`/`tasks` 容器一致,无需独立模块。 |

---

## 4. 改动清单(按 package,自底向上)

### 4.1 `@brainpilot/protocol`

**`src/http.ts` — 放宽 `/messages` 入参**

`SendMessageRequestSchema` 改为接受两种 body 的联合:
- 现有发消息形:`{ content: string, agent?: string, data?: {...} }`
- 回答形:`{ type: "user_input_response", session_id: string, request_id: string, answer: string }`

其余 schema(`UserInputRequestEventSchema` 等)已存在,不动。`RUNTIME_ROUTES` 不变(复用 `sendMessage` 路由)。

### 4.2 `@brainpilot/runtime`

**`src/events.ts`** — 新增 builder:
```ts
ev.userInputRequest(ctx, {
  request_id, agent, question, options?, allow_free_text?
}): AgUiEvent  // type: "user_input_request"
```

**`src/tools/system-tools.ts`**
- `ToolDeps` 接口新增回调:
  ```ts
  requestUserInput: (req: {
    question: string; options?: string[]; allow_free_text?: boolean;
  }) => Promise<string>;
  ```
- 新增 `createAskUserTool(deps)`:
  - 参数 schema:`{ question (required), options?: string[], allow_free_text?: boolean }`
  - `execute`: `const answer = await deps.requestUserInput({...}); return ok(answer);`
- `allSystemTools(deps)` 注册 `createAskUserTool`。
- `AGENT_TOOL_CONFIG.principal` 追加 `"ask_user"`。

**`src/session-manager.ts`**
- `SessionEntry` 新增字段 `pendingInputs: Map<string, Deferred<string>>`(创建 session 时初始化空 Map)。
- 在 `ensureAgent` 构造 `ToolDeps` 处(`session-manager.ts:554-565`),注入 `requestUserInput` 回调,闭包捕获 `this`、`sessionId`、`name`(发问的 agent)。
- 新方法 `requestUserInput(entry, agent, req)`:
  1. `request_id = randomUUID()`
  2. `entry.bus.emit(ev.userInputRequest({sessionId, runId: entry.activeRunId}, {request_id, agent, ...req}))`
  3. 建 deferred,存入 `entry.pendingInputs.set(request_id, deferred)`
  4. `return deferred.promise`
- 新方法 `resolveInput(sessionId, request_id, answer): boolean`:
  - 找到 entry 与 deferred → `deferred.resolve(answer)` → `pendingInputs.delete(request_id)` → 返回 `true`
  - 找不到(session 不存在、未知 / 已消费 request_id)→ 返回 `false`(纯查表,不抛错;server 在调用前已用 `getSession` 处理 404)
- `interrupt`(`session-manager.ts:533-542`):abort 各 agent 后,遍历 `entry.pendingInputs` 全部 `reject(new Error("interrupted"))` 并 `clear()`。
- `evictSession`(`session-manager.ts:~460`):清理时 reject 并清空 `pendingInputs`,防 promise 泄漏。
- 需要一个小 `Deferred<T>` 工具(`{promise, resolve, reject}`),就近定义或放入小工具模块。

**`src/server.ts`** — `/messages` handler(`server.ts:73-83`)分流:
- 解析 body 后,若 `body.type === "user_input_response"`:
  - `const okResolved = await manager.resolveInput(id, body.request_id, body.answer)`
  - 返回 `{ status: okResolved ? "ok" : "stale" }`(HTTP 200;session 不存在仍按现有逻辑 404)
- 否则走现有 `sendMessage(...)` 分支。

### 4.3 `@brainpilot/web`

**零改动。** `respondToInput()` 已在发送正确的 body。

---

## 5. 数据流

```
principal turn 中调 ask_user(question)
  └─ tool.execute → deps.requestUserInput()
       ├─ request_id = randomUUID()
       ├─ bus.emit(user_input_request)  ──SSE──▶ 前端渲染 AskUserCard
       └─ await deferred  ← turn 阻塞于此(status 仍 running)
                                  │
用户在卡片作答 → respondToInput()  │
  └─ POST /messages {type:user_input_response, request_id, answer}
       └─ server 分流 → manager.resolveInput(request_id, answer)
            └─ deferred.resolve(answer) + map.delete
                 └─ ask_user.execute 返回 answer → principal turn 继续
```

**取消路径**:`interrupt` → reject 所有 `pendingInputs` → `ask_user.execute` 抛错 → turn 干净结束。

---

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| 未知 / 已消费 `request_id`(重复回答、已取消) | `resolveInput` 返回 `false`;server 回 `{status:"stale"}`,HTTP 200 |
| session 不存在 | 沿用现有 `/messages` 404 逻辑 |
| 等待时 `interrupt` | deferred reject → 工具 throw → turn 终止 |
| 等待时 `evictSession` | deferred reject + 清空 map,无悬挂 promise |
| deferred 泄漏防护 | resolve/reject 后**必从 map 删除**条目 |

---

## 7. 测试(全程 `BP_MOCK=1`,不烧 quota)

mock agent 在 `mock-agent.ts:100` 同样 `await tool.execute(args)`,故 deferred 阻塞在 mock 路径下完全生效,链路可端到端测试。

- **单元(session-manager)**:`requestUserInput`/`resolveInput` 配对成功;`resolveInput` 未知 id 返回 `false`;`interrupt` reject 所有挂起项;`evictSession` 清空挂起项。
- **协议(http)**:`SendMessageRequestSchema` 接受两种 body;拒绝非法 body。
- **集成(mock 驱动)**:principal prompt 含 `[[tool:ask_user {"question":"X"}]]` → 断言 SSE 出现 `user_input_request` 且 prompt promise 尚未 resolve → 调 `resolveInput` → 断言 prompt 完成、tool result == answer。
- **server**:POST `/messages` 带 `user_input_response` → 200 且 `resolveInput` 被调用;stale id → `{status:"stale"}`。
- **访问控制(tool-access)**:`ask_user` 仅 principal 可见,专家不可见。

---

## 8. 非目标(YAGNI)

- 不实现 `timeout_sec` 定时器(字段保留)。
- 不让专家 agent 直接 ask_user(走 principal 转问)。
- 不新增 status 枚举值(如 `waiting`)。
- 不新增专用 HTTP 路由(复用 `/messages`)。
- 前端不做任何改动。
