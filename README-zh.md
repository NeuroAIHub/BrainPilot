<!-- <p align="center">
  <img src="assets/banner.png" alt="BrainPilot" width="680"/>
</p> -->

<h1 align="center">🧠 BrainPilot</h1>

<p align="center">
  面向可信脑科学研究的开源多智能体平台 ——
  由一个 Principal 智能体统筹多个专家智能体，替你读文献、做推理、跑真实分析。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@brainpilot/app"><img src="https://img.shields.io/npm/v/@brainpilot/app?style=flat-square&logo=npm&color=CB3837" alt="npm version"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square" alt="License: AGPL v3"/></a>
  <a href="#"><img src="https://img.shields.io/badge/Demo-即将上线-lightgrey?style=flat-square" alt="Live Demo (coming soon)"/></a>
  <a href="#"><img src="https://img.shields.io/badge/Paper-即将公开-lightgrey?style=flat-square" alt="Paper (coming soon)"/></a>
  <a href="https://github.com/NeuroAIHub/BrainPilot/stargazers"><img src="https://img.shields.io/github/stars/NeuroAIHub/BrainPilot?style=flat-square" alt="Stars"/></a>
  <br/>
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A522-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 22"/>
  <img src="https://img.shields.io/badge/Hono-4-E36002?style=flat-square&logo=hono&logoColor=white" alt="Hono"/>
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React"/>
  <img src="https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite"/>
  <img src="https://img.shields.io/badge/Pi_SDK-orchestration-8A2BE2?style=flat-square" alt="Pi SDK"/>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README-zh.md">简体中文</a>
  <br/>
  <a href="#-快速开始">快速开始</a> ·
  <a href="#-资源与知识库">资源</a> ·
  <a href="#-接入-mcp-服务">MCP</a> ·
  <a href="#-docker-部署">Docker</a> ·
  <a href="#-参与贡献">参与贡献</a> ·
  <a href="#-社区交流">社区交流</a>
</p>

---

## 📖 项目简介

**BrainPilot** 是一个面向脑科学与认知科学研究的开源、单用户多智能体协作平台。一个
**Principal（主控）** 智能体与你对话、规划任务，并把工作委派给 **专家智能体**（文献官、分析
师、写作者……），它们通过基于文件的信箱（mailbox）协作。每个智能体读取、写入或生成的文件都
会落到磁盘上真实的工作区里，整个运行过程会被记录为一张可供检视的 **轨迹图（trace graph）**。

它使用 **TypeScript + [Pi SDK](https://pi.dev)** 做智能体编排，以 **Hono** 后端配 **React**
单页前端对外提供服务。最快的上手方式是一条 npm 安装命令 —— **无需 Docker**。

### 核心亮点

- **🚀 一条命令启动** —— `npm i -g @brainpilot/app` 后 `brainpilot up`，打开浏览器即可开工。
- **🤝 主控 + 专家** —— 主控智能体通过文件信箱把任务委派给领域专家。
- **📚 内置技能库** —— 经过验证的脑科学/认知科学方法学，按需经 MCP 检索调用。
- **🔌 原生 MCP 工具** —— 接入任意 Model Context Protocol 服务（stdio / streamable-http / sse）。
- **🔭 可检视的运行** —— 每个会话有独立工作区，外加一张记录全过程的轨迹图。
- **🧩 自带模型** —— 默认走 Anthropic，也可在 Settings UI 配置任意 Anthropic / OpenAI 兼容网关。

---

## 🚀 快速开始

BrainPilot 通过 **`@brainpilot/app`** 以本地进程方式运行 —— 无需 Docker，这是推荐的上手方式。

### 环境要求

- **Node.js** ≥ 22
- 一个 **Anthropic API Key** —— *或* 用 `BP_MOCK=1` 做无 Key 冒烟运行

### 1. 安装

```bash
npm install -g @brainpilot/app
```

这会安装 `brainpilot` 命令（`bnpt` 是同一命令的内置短别名）。

### 2. 初始化

```bash
brainpilot init --api-key <你的-anthropic-key>   # 在 ./brainpilot 下生成配置
```

缺少 Key 不再阻塞启动 —— `brainpilot up` 仍会启动，你可以在打开后的 Web **Settings UI** 里设置
**provider url / key / model**（推荐做法，会自动帮你写入配置）。你也可以改用环境变量
`ANTHROPIC_API_KEY` 提供 Key。

### 3. 启动

```bash
brainpilot up        # 默认前台运行；Ctrl-C 停止
```

然后在浏览器打开命令打印出的地址，开始一个会话。没有 Key？可以先冒烟跑一下：

```bash
BP_MOCK=1 brainpilot up
```

<details>
<summary><b>后台模式、状态与日志</b></summary>

把后端作为由 CLI 管理的后台进程运行：

```bash
brainpilot up --detach
brainpilot status    # 健康状态 + 子进程 pid（后台模式）
brainpilot logs      # 跟踪后端日志；加 --runtime 看运行时日志
brainpilot down      # 停止后台后端
```
</details>

<details>
<summary><b>你的文件存放在哪里</b></summary>

`brainpilot up` 会解析出一个 **数据目录**，并把所有东西都放在它下面。优先级：
`--dir <path>` > `BP_DATA_DIR` 环境变量 > 当前工作目录下的 `./brainpilot`。所以直接
`brainpilot up` 用的就是 `./brainpilot/`。

```
brainpilot/                       # 数据根目录（默认 ./brainpilot）
├── workspaces/<sessionId>/       # 智能体的工作目录（cwd）—— 每个会话一个；
│                                 #   智能体读写/生成的每个文件都落在这里
├── bp_template/                  # 配置（由 `brainpilot init` 写入）
│   ├── providers.json            #   API key / base URL / model（providers）
│   ├── settings.json             #   运行时设置
│   ├── mcp_servers.json          #   MCP 服务连接
│   ├── agents/                   #   自定义智能体 persona
├── .bp/<sessionId>/              # 每会话状态（元数据、轨迹图）
├── brainpilot.config.json        # 本地顶层配置
├── .env                          # 环境变量
└── .runtime/                     # 进程状态：logs/、pid 文件、server.json
```

> **信任边界。** 在本地（非 Docker）模式下 **没有容器隔离** —— 智能体直接在你的机器上读写，路径
> 为 `brainpilot/workspaces/<sessionId>/`。该模式下 UI 会隐藏 *Sandbox* 控件，因为没有可挂载的
> Docker 沙箱。如需隔离，请使用 [Docker 部署](#-docker-部署)，它会把智能体跑在沙箱容器内。
</details>

### 让你的编码智能体替你部署

已经在用 **Claude Code** 或 **OpenAI Codex**？那就不用手动跑上面的步骤了 —— 一句话把整套安装交给智能体，
它会帮你装好 CLI、启动 BrainPilot，并把本地访问地址回给你：

```bash
# Claude Code
claude "全局安装 @brainpilot/app 这个 npm 包，然后运行 brainpilot up，并把可以打开的地址给我。"

# OpenAI Codex
codex exec "全局安装 @brainpilot/app 这个 npm 包，然后运行 brainpilot up，并把可以打开的地址给我。"
```

默认情况下，智能体在每条命令前都会停下来等你确认。想让它全程无人值守地跑完，可以加上
`--dangerously-skip-permissions`（Claude Code）或 `--dangerously-bypass-approvals-and-sandbox`（Codex）
—— 仅在你信任的目录里这么做。还没有 API Key？让它*“用 mock 模式启动”*，它就会以 `BP_MOCK=1` 拉起来。

---

## 🤖 使用自己的模型

BrainPilot 默认对接 Pi 内置的 Anthropic 端点。改用其他端点最简单的方式是启动后用 **Settings
UI**：打开 **Settings → Providers（服务商）**（Settings 按钮在侧边栏），点 **添加服务商**，填入
base URL、API key、协议和模型列表。你还能在这里 **测试** 连接、切换当前使用的服务商 —— 它会自动
帮你写入配置，无需手动改文件。

也可以在 init 时用一条命令接入网关 / 第三方端点：

```bash
brainpilot init --api-key <key> --base-url https://your-gateway.example.com/api --model kimi-k2.6
```

<details>
<summary><b>进阶：完整 <code>models.json</code>（多 provider、OpenAI 兼容端点、自定义 header）</b></summary>

如需多个 provider、自定义 header、`compat` 开关，或 OpenAI 兼容端点（Ollama / vLLM），把模板复制
到数据目录并编辑：

```bash
cp models.example.json brainpilot/models.json   # brainpilot/ = 你的数据目录
```

然后让运行时指向它：

```bash
BP_MODELS_JSON=/绝对路径/brainpilot/models.json
ANTHROPIC_MODEL=<该文件里的某个 model id>
BP_MODEL_PROVIDER=<provider 名>   # 可选；默认 = 文件里第一个 provider
```

完整的 `models.json` schema —— `api` 类型、`compat` 开关、`$ENV` key 插值、按模型的成本/上限 ——
见 <https://pi.dev/docs/latest/models>。
</details>

---

## 📚 资源与知识库

### 内置技能库

智能体可以按需调用 **经过验证的领域方法学** —— 无需任何配置。内置技能以 `@brainpilot/skills`
内容包形式提供，通过 **Pi 原生的 skill 流水线** 加载（独立于 MCP）：每个技能的 `name` +
`description` 会被放进智能体的系统提示，完整的 `SKILL.md` 正文按需读取（渐进式披露）。智能体也可
以用 `/skill:<name>` 强制加载某个技能。

技能来源：

- [Awesome Cognitive & Neuroscience Skills](https://github.com/NeuroAIHub/awesome_cognitive_and_neuroscience_skills)，精选的认知科学与神经科学技能合集
- [nature-skills](https://github.com/Yuan1z0825/nature-skills)，从 Nature 系列方法中提炼的技能
- [MNE-Python](https://github.com/mne-tools/mne-python) 与 [pycortex](https://github.com/gallantlab/pycortex)，用 `repo-to-skill` 集成（见下文）

技能位于 `packages/skills/skills/`，按两级目录树组织：`<category>/<skill-name>/SKILL.md`（可选
`references/` 存放可下钻的细节）。部署时它们会被 **物化到你的数据目录**
`<data-dir>/bp_template/skills/`（一份可编辑的副本；已存在的技能永不会被覆盖）。覆盖领域包括
EEG/ERP、fMRI、计算建模、心理语言学、临床神经心理学、可视化、科研写作等。

<details>
<summary><b>技能分类与如何新增技能</b></summary>

`packages/skills/skills/` 下现有分类：

| 目录 | 领域 |
|--------|--------|
| `01_Meta-Skills` | 技能编写与评审 |
| `02_Cross-Domain_Foundation` | 统计、可视化、科研素养 |
| `03_Cognitive_Psychology` | 范式、评分、DDM、SDT |
| `04_Psycholinguistics` | 阅读时、SPR、刺激常模 |
| `05_EEG_ERP` | EEG 预处理、ERP 分析、MNE-Python |
| `06_fMRI_Neuroimaging` | fMRI 预处理、GLM、pycortex、解码 |
| `07_Computational_Modeling` | ACT-R、贝叶斯建模、参数恢复 |
| `08_Computational_Neuroscience` | 神经群体分析、脉冲网络 |
| `09_Cellular_Molecular_Neuroscience` | 钙成像、光遗传学 |
| `10_Clinical_Neuropsychology` | 损伤-症状映射、量表选择 |
| `11_Developmental_Cognition` | 婴儿注视时长实验设计 |
| `12_Social_Cognition` | 心理理论任务选择 |
| `13_Visualization` | Nature 风格图表创作与设计 |
| `14_Writing` | Markdown 报告写作 |
| `15_Others` | 神经影像功效/样本量指南 |

**新增一个技能：**

1. 选择（或新建）一个分类目录，然后创建 `<category>/<skill-name>/SKILL.md`，带上必需的 YAML
   frontmatter：

   ```yaml
   ---
   name: "<skill-name>"
   description: "<用于关键词匹配的一句话摘要>"
   domain: "<domain>"
   version: "1.0.0"
   ---
   ```

   `description` 字段会被放进每个智能体的系统提示，是模型判断技能是否相关的依据 —— 让它富含关键
   词、足够具体。（`name` + `description` 必填；没有 description 的技能不会被加载。）

2.（可选）在 `references/` 下添加参考文件以提供更深入的细节（参数表、API 文档、范例）。智能体用
   它的 `read` 工具按需读取 —— 渐进式披露让系统提示保持精简，可下钻材料随时可取。

3. 构建并重启：`npm run build -w packages/skills`，然后重启运行时。新技能会在下次启动时被物化到
   `<data-dir>/bp_template/skills/`（已存在的文件不会被覆盖）。你也可以直接把技能丢进
   `<data-dir>/bp_template/skills/`，无需重新构建该包。

**质量准则：** 技能编码的是经过验证的领域方法学 —— 每个数值参数都需要引用；`SKILL.md` 控制在
500 行以内；原始参考材料放 `references/` 而非内联。完整的贡献流程见 `contribute-skills-via-pr`
与 `verify-skill` 两个 Meta-Skills。
</details>

### 构建你自己的技能库

我们 demo 里展示的技能，都是从我们自己的论文库与方法学库中提取出来的。你也可以用同样的方式、借助
我们开源的工具，构建属于你自己的技能库 —— 把它们对准 **你** 关心的论文、代码库和方法：

- **`paper-to-skill`**（内置 Meta-Skill）—— 给智能体一篇论文（PDF 或文本），让它"把这篇论文变成
  一个 skill"，它会把可复现的方法学提取成一份初稿 `SKILL.md`。
- **`repo-to-skill`**（内置 Meta-Skill）—— 给它一个 GitHub 链接或本地仓库路径，它会把代码库转换
  成带渐进式披露的结构化技能。我们已用它集成了 [MNE-Python](https://github.com/mne-tools/mne-python)、
  [pycortex](https://github.com/gallantlab/pycortex) 等知名工具；
  [DeepLabCut](https://github.com/DeepLabCut/DeepLabCut) 已在计划中。
- **批量提取流水线** —— 想一次性转换 *一整个文件夹* 的论文/转录稿，可用公开仓库
  [`awesome_cognitive_and_neuroscience_skills`](https://github.com/NeuroAIHub/awesome_cognitive_and_neuroscience_skills)
  里的 `pipeline/` 工具：`pip install -r pipeline/requirements.txt`，
  `cp pipeline/config.example.yaml pipeline/config.yaml`，把 `.txt`/`.md` 源文件放进 `input/`，
  配好 API key，运行 `python pipeline/extract.py --config pipeline/config.yaml`。它会产出标准的
  `SKILL.md`，直接丢进 `<data-dir>/bp_template/skills/` 即可。
- **现成合集** —— 也可以直接安装我们公开仓库里现成的技能：
  [`awesome_cognitive_and_neuroscience_skills`](https://github.com/NeuroAIHub/awesome_cognitive_and_neuroscience_skills)
  和 [`nature-skills`](https://github.com/Yuan1z0825/nature-skills)。把任意
  `<category>/<skill-name>/` 文件夹拷进 `<data-dir>/bp_template/skills/` 即可（无需重新构建）。

> ⚠️ 其中有些技能是 AI 生成的（从文献或代码库中提取），可能存在错误 —— **在真实研究中依赖之前，请
> 先核验参数与引用。**

### 知识库与论文库

我们的托管 demo 是基于 **我们自己精选的知识库与论文库** 来回答的。这些我们暂时还无法以公开服务的
形式提供，因此 BrainPilot 不内置知识库 —— 而是让你 **接入你自己的**。内置的 `librarian` 智能体已
经能通过你提供的检索工具去搜索论文、网络来源和知识库：

- **接入一个检索型 MCP 服务**，对准你自己的语料（向量库、论文归档、一堆 PDF 的文件系统、内网搜索
  API）—— 见 [接入 MCP 服务](#-接入-mcp-服务)。你添加的任何 MCP 服务都会自动作为智能体工具出现。
- **把关键论文转成技能**，用上面的 `paper-to-skill` / 批量流水线，让方法学常驻在智能体上下文里 ——
  这是不搭建检索服务的轻量替代方案。

> 🚧 一个开箱即用的托管知识库已在路线图上。在此之前，上面两条路径已经能让自部署的 BrainPilot 立刻
> 跑在 *你自己的* 文献之上。

---

## 🔌 接入 MCP 服务

智能体可以调用通过 **Model Context Protocol** 提供的工具。运行时会把每个已配置的 MCP 服务桥接进
智能体的工具集：每个远端工具以 `mcp__<server>__<tool>` 的命名空间出现。支持三种传输方式 ——
**stdio**（拉起本地进程）、**streamable-http** 和 **sse**（远端）。

> 💡 **推荐：** 用 [Tavily](https://www.tavily.com/) 给智能体做联网搜索。

最简单的添加方式是启动后用 **Settings UI**：打开 **Settings → MCP**（Settings 按钮在侧边栏），
点 **添加服务器**，选一种传输方式（stdio / http / sse），再填入 command + args（stdio）或
url + headers（http/sse）。同一标签页里也能编辑或移除服务器，它会自动帮你写入配置，无需手动改
文件。

更想用配置文件？`brainpilot init`（以及首次启动会做 scaffold 的 `brainpilot up`）会在你的
**数据目录** 写入 `mcp_servers.json`（`<data-dir>/bp_template/mcp_servers.json`）。scaffold 是
幂等的 —— 已存在的文件永不会被覆盖。

<details>
<summary><b>配置格式与三种传输方式</b></summary>

编辑 `<data-dir>/bp_template/mcp_servers.json`（全局，所有会话共享）或
`<data-dir>/.bp/<session-id>/mcp_servers.json`（按会话）。格式是标准的 MCP/Claude `mcpServers`
映射；用 `type` 选择传输方式：

```jsonc
{
  "mcpServers": {
    // 本地进程，走 stdio（省略 type 时默认为 "stdio"）：
    "fs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      "env": {}
    },
    // 远端，走 streamable-http，带鉴权 header：
    "my-api": {
      "type": "http",
      "url": "https://your-host.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    },
    // 远端，走 server-sent events：
    "my-events": {
      "type": "sse",
      "url": "https://your-host.example.com/sse",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

字段说明：
- `type` —— `"stdio"` | `"http"` | `"sse"`。省略 ⇒ `"stdio"`。
- `command` / `args` / `env` —— 仅 stdio：要拉起的可执行程序及其环境变量。
- `url` —— 仅 http/sse：服务端点。
- `headers` —— 仅 http/sse：额外的 HTTP header（如 `Authorization`）。

http/sse 条目若 `url` 留空（或 stdio 条目无 `command`），会被当作未配置的占位项，在启动时静默跳
过。一份覆盖三种传输方式、可直接复制的示例会写到 `bp_template/mcp_servers.example.json`。
</details>

---

## 🐳 Docker 部署

上面的 npm 路径是推荐的单用户方案。当你需要容器化、可复现的部署，或需要智能体沙箱隔离时，再用
Docker。

```bash
cp .env.example .env
# 编辑 .env：设置 ANTHROPIC_API_KEY（或 BP_MOCK=1），按需调整端口
docker compose up -d --build
```

打开 <http://localhost:9001>（或你的 `BP_MAIN_PORT`）。停止用 `docker compose down`。

<details>
<summary><b>沙箱依赖、部署模式与内存预算</b></summary>

**自定义沙箱依赖。** `brainpilot-sandbox` 镜像默认是一个轻量基线（仅 Node + 运行时）。要添加
Python、系统包或全局 npm 工具，编辑 `docker/sandbox/extra-deps.sh`（内含范例），然后重建：
`docker compose build sandbox`。

**部署模式**（仅 Docker —— npm 路径始终是单用户、本地进程）：

| 模式 | 沙箱拓扑 | 选择方式 | 本仓库 |
|------|----------|----------|--------|
| `static` | 1 个共享 `main` + 1 个固定 `sandbox`，单用户 | 设置 `BP_RUNTIME_URL` | ✅ 已发布 |
| `dynamic` | 共享 `main` + 经 docker.sock 按用户拉起的 sandbox | `BP_ORCHESTRATOR=docker` | 🚧 仅骨架 |

**内存预算（`BP_MEM_LIMIT_MB`，可选）。** 对内存受限的容器，把它设为单容器预算（MB），运行时会
在内核 OOM 之前自我限流（超过预算约 85% 时拒绝新工作）。严格 opt-in；单用户沙箱推荐下限约
2 GB。在启动器侧设置 `NODE_OPTIONS=--max-old-space-size=<预算的约 75%>` 以加 V8 堆上限。完整的
Docker 与发布细节见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
</details>

---

## 🤝 参与贡献

欢迎各种形式的贡献 —— bug 反馈、技能、新功能、文档都有帮助。
完整指南（开发环境、分支模型、从源码运行、测试、发布流程）见
**[CONTRIBUTING.md](CONTRIBUTING.md)**；私下报告安全漏洞见 **[SECURITY.md](SECURITY.md)**。

BrainPilot 是一个 7 包的 TypeScript monorepo：

| 包 | 角色 |
|---------|------|
| `@brainpilot/protocol` | zod 线协议 SSOT：AG-UI 事件联合、领域类型、HTTP 路由契约 |
| `@brainpilot/runtime` | Pi SDK 编排、SessionManager（状态权威）、mailbox、系统工具、MCP bridge、Hono+SSE 服务 |
| `@brainpilot/backend-core` | Hono REST + SSE 字节透传、Orchestrator 抽象（Local / Static / Docker） |
| `@brainpilot/web` | React/Vite SPA（AG-UI 消费端） |
| `@brainpilot/app` | `brainpilot` / `bnpt` —— 免 Docker 本地启动 |
| `@brainpilot/skills` | 内置技能内容库（物化到数据目录，经 Pi 原生 skill 流水线加载） |
| `@brainpilot/client-cli` | `bp-client` —— 无头端到端验证客户端 |

---

## 💬 社区交流

有问题、有想法，或者只想打个招呼？欢迎加入我们的飞书开源社区群：

- 🪶 **[加入 BrainPilot 飞书群 →](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=0far82db-f790-412e-9217-58ae67df4313)**
- 📧 **联系邮箱：** [hx-li25@mails.tsinghua.edu.cn](mailto:hx-li25@mails.tsinghua.edu.cn)

你也可以[提一个 issue](https://github.com/NeuroAIHub/BrainPilot/issues/new/choose)或发起讨论。

---

## ⭐ Star 趋势

[![Star History Chart](https://api.star-history.com/svg?repos=NeuroAIHub/BrainPilot&type=Date)](https://star-history.com/#NeuroAIHub/BrainPilot&Date)

---

## 📄 许可证

BrainPilot 基于 **[GNU AGPL v3](LICENSE)** 许可证开源。
