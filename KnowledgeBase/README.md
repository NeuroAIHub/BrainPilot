# BrainPilot Knowledge Base

[English](#english) · [中文](#中文)

---

## English

An end-to-end toolkit for building a **local** RAG domain knowledge base for BrainPilot. Drop your PDFs into `source/pdf/`, run the pipeline once, and the agent can immediately retrieve the indexed content through two built-in tools: `get_domain_knowledge_local` and `search_papers_local`. Embedding and reranker models run **on your own machine** — no daemon, no public port, no third-party retrieval service.

### 1. Pipeline at a glance

```
                                                            ┌──────────────────┐
 source/pdf/*.pdf                                            │  agent runtime  │
        │                                                    │  (TypeScript)   │
        │ ① OCR  (SiliconFlow DeepSeek-OCR)                 │                 │
        ▼                                                    │  get_domain_    │
 source/mmd/<title>/<title>.mmd            ┌────────────────►│  knowledge_local│
        │                                  │                 │  search_papers_ │
        │ ② metadata extract (LLM)         │                 │  local          │
        ▼                                  │                 └────────┬────────┘
 source/KB_source.json                     │                          │
        │                                  │                          ▼
        │ ③ chunk (offline, CPU)           │   ④ retrieve = bge-m3 embed +
        ▼                                  │      bge-reranker-v2-m3 rerank
 chunks/chunks.json                        │            │
        │                                  │            ▼
        │ ④ vectorize (bge-m3)             └─── model_server.py (local sidecar,
        ▼                                       loopback only, GPU/MPS/CPU)
 vectorstore/{embeddings.npy,
              chunks.jsonl,
              index.json,
              meta.json}
```

Each of the four stages is **independent and idempotent** — a PDF already in `OCRed_pdf.json` is never re-OCR'd, an `.mmd` already in `chunks.json` is never re-chunked, a `chunk_id` already in `index.json` is never re-embedded. Every path is rooted at `KB_ROOT` (defaults to this directory).

### 2. One-button build (web UI)

The simplest entry point is the BrainPilot main UI: **Settings → Knowledge Base**.

1. Copy your PDFs into `KnowledgeBase/source/pdf/` (the panel reminds you of the exact path).
2. Enter the **SiliconFlow OCR API key** (required for OCR).
3. Metadata extraction defaults to *"Reuse the agent's active LLM key"*; uncheck it to provide a separate `base URL / model / key` triple.
4. Choose which stages to run (all four by default).
5. Click **Build Knowledge Base**.

A stage-by-stage progress strip and a live log stream from the backend over SSE; OCR failures, metadata fallback rows, and failed vectorize batches all show up colour-coded. **Cancel build** sends SIGTERM to the orchestrator; all on-disk artefacts (`OCRed_pdf.json`, `KB_source.json`, `chunks.json`, `vectorstore/`) are written atomically, so the next run resumes cleanly.

### 3. Python environment (do this once, the web button needs it too)

The pipeline runs in Python and **needs its own venv** — both for the four
build stages (PyMuPDF, openai, …) and for the bge sidecar (PyTorch +
FlagEmbedding). There are two ways to create it.

#### 3a. From the web UI (recommended)

Open **Settings → Knowledge Base**. If the venv doesn't exist yet, the
panel shows a yellow banner with a **"Set up Python environment"** button.
Click it — the backend spawns `scripts/setup_env.py` (stdlib only, runs
on whatever Python is on PATH), creates `KnowledgeBase/.venv`, and streams
pip's progress to the same live log you'd see during a build. Two to five
minutes later the banner turns green and the **Build Knowledge Base**
button enables itself.

The same panel also shows a smaller **"Reinstall venv"** button after the
venv exists, in case a dependency upgrade gets stuck.

#### 3b. From the command line

```bash
# Linux / macOS
bash KnowledgeBase/scripts/setup_env.sh

# Windows (PowerShell / cmd)
KnowledgeBase\scripts\setup_env.bat

# Cross-platform stdlib equivalent (what the web button calls)
python KnowledgeBase/scripts/setup_env.py
```

The shell scripts auto-pick the newest Python ≥ 3.10 on `PATH`. To pin one
explicitly: `setup_env.sh --python /opt/python3.11/bin/python3`.

Once `.venv` exists, **both the web UI's "Build Knowledge Base" button and the
`build_kb.py` CLI auto-detect it** — you never have to `source .venv/bin/activate`,
and you don't need to set any env var. The auto-detection priority is:

1. `BP_KB_PYTHON` env var (set this if you keep your env somewhere unusual)
2. `<KB_ROOT>/.venv/bin/python` (Unix) or `\.venv\Scripts\python.exe` (Windows) — what `setup_env` produces
3. `PYTHON` env var
4. `python3` / `python` on `PATH` (last-resort fallback; the backend
   actively refuses to spawn when only this remains, because requirements
   probably aren't installed system-wide)

If you already manage a conda env / system-wide install you want to reuse,
set `BP_KB_PYTHON=/abs/path/to/python` before launching BrainPilot and
the venv check is bypassed entirely.

### 4. Command-line build

```bash
# 1. (one-time) bootstrap the venv  (see §3)
bash KnowledgeBase/scripts/setup_env.sh

# 2. (one-time) download embedding + reranker weights (~2.5 GB)
KnowledgeBase/.venv/bin/python KnowledgeBase/scripts/setup_models.py
#   Users in CN: --hf-mirror https://hf-mirror.com

# 3. Drop PDFs into source/pdf/, then build:
export SILICONFLOW_API_KEY=sk-...
export META_LLM_API_KEY=sk-...
export META_LLM_BASE_URL=https://api.example.com
export META_LLM_MODEL=deepseek-chat
python KnowledgeBase/scripts/build_kb.py
# (build_kb.py hands the run off to .venv/bin/python automatically; you can
#  also use a globally-installed `python` here — it doesn't need the deps.)
```

You can also run only specific stages:

```bash
python KnowledgeBase/scripts/build_kb.py --skip-ocr                # mmd already there
python KnowledgeBase/scripts/build_kb.py --only chunk vectorize    # re-chunk + re-embed
```

Each stage script also runs standalone:

| Script | Input | Output |
|--------|-------|--------|
| `scripts/ocr_pdfs.py` | `source/pdf/*.pdf` | `source/mmd/<title>/*.mmd`, `source/OCRed_pdf.json` |
| `scripts/extract_meta.py` | `source/OCRed_pdf.json` | `source/KB_source.json` |
| `scripts/chunk.py` | `source/KB_source.json` | `chunks/chunks.json` |
| `scripts/vectorize.py` | `chunks/chunks.json` | `vectorstore/{embeddings.npy, chunks.jsonl, index.json, meta.json}` |

Add `--json` to any script and it emits one NDJSON event per line on stdout — that's how the web panel parses progress.

### 5. API keys and config

During the build, scripts resolve keys in the priority order **CLI flag → environment variable → `source/API_config.json`**.

- **OCR**: `SILICONFLOW_API_KEY` (the script targets SiliconFlow's DeepSeek-OCR model).
- **Metadata extract**: any OpenAI-compatible endpoint. Env vars are `META_LLM_API_KEY` / `META_LLM_BASE_URL` / `META_LLM_MODEL`.

Optional `source/API_config.json` (gitignored):

```json
{
  "siliconflow": { "API_KEY": "sk-..." },
  "meta_extract": {
    "BASE_URL": "https://api.example.com",
    "API_KEY":  "sk-...",
    "MODEL":    "deepseek-chat"
  }
}
```

The embedding + reranker models always run **locally** and need no key.

### 6. The two agent-facing tools

After the build completes, the BrainPilot runtime automatically exposes two system tools to every non-trace agent:

#### `get_domain_knowledge_local(query, topk=5, min_rerank_score=0.5) -> str`

Two-stage retrieval against the natural-language `query`:

1. Embed the query with bge-m3.
2. Cosine top-(topk × 10) against `embeddings.npy`.
3. Rerank those candidates with bge-reranker-v2-m3.
4. Return the top `topk` whose rerank score is ≥ `min_rerank_score`, as one multi-block string with `title / authors / journal / date / chunk position / passage`.

All failure modes (KB not built yet, sidecar can't start, model weights missing, store corrupt) return as `"ERROR: ..."` strings — the tool never throws.

#### `search_papers_local(title?, authors?, journal?, published_year?, keywords?, topk=5, mode=meta-data, segment=1) -> str`

Filter the `KB_source.json` library by exact title / author overlap / exact journal / year prefix, rank by whole-word keyword hits across `title + abstract` (and the full `.mmd` body in `full-paper` mode).

- `mode="meta-data"` → metadata + `keyword_hits`.
- `mode="full-paper"` → adds a `~20k-char` segment of the `.mmd` and `segment_info` so long papers can be paged.

Internal fields (`mmd_path`, `extraction_status`) are stripped from every returned record.

⚠️ All filters are **exact-match**: `journal="Nat Commun"` will miss "Nature Communications"; `published_year=2020` excludes any paper with an empty `published_date`. When unsure, lean on `keywords` and drop the filter.

### 7. How the local model deployment works

- Weights live under `models/bge-m3/` and `models/bge-reranker-v2-m3/`. `scripts/setup_models.py` downloads them from HuggingFace (resumable; ~2.5 GB).
- Inference happens in a **single-user loopback sidecar** — `server/model_server.py` — spawned automatically by the runtime on the first retrieval call, and torn down when the BrainPilot process exits.
  - Not a systemd daemon, never binds to a public interface, no nginx/Docker required.
  - Picks GPU → MPS → CPU, runs fp16 on accelerators and fp32 on CPU.
- Already have a bge service somewhere? Set `BP_KB_SERVER_URL=http://<host>:<port>` and the runtime reuses it instead of spawning.
- Offline use: pre-download with `setup_models.py`, then `build_kb.py --skip-ocr --skip-extract` works without a network.

### 8. Layout

```
KnowledgeBase/
├── README.md
├── requirements.txt
├── .gitignore
│
├── .venv/                   ← created by scripts/setup_env.sh (gitignored)
│
├── source/
│   ├── pdf/                 ← drop PDFs here
│   ├── mmd/                 ← OCR output (one subdir per paper)
│   ├── OCRed_pdf.json       ← OCR ledger (resumability)
│   ├── KB_source.json       ← metadata library (agent-visible)
│   └── API_config.json      ← optional key bundle (gitignored)
│
├── chunks/
│   └── chunks.json          ← incremental chunk store
│
├── vectorstore/
│   ├── embeddings.npy       ← float32 (N, 1024), L2-normalised
│   ├── chunks.jsonl         ← one chunk per line, same order as embeddings
│   ├── index.json           ← chunk_id → row index
│   └── meta.json            ← {dim, model, count, updated_at, normalized}
│
├── models/
│   ├── bge-m3/              ← downloaded by setup_models.py
│   └── bge-reranker-v2-m3/  ← downloaded by setup_models.py
│
├── server/
│   └── model_server.py      ← single-user loopback sidecar
│
└── scripts/
    ├── _common.py           ← shared paths + NDJSON events
    ├── setup_env.py         ← create .venv + install requirements (cross-platform; called by the web button)
    ├── setup_env.sh         ← shell wrapper for Linux / macOS
    ├── setup_env.bat        ← shell wrapper for Windows
    ├── setup_models.py      ← download bge model weights
    ├── ocr_pdfs.py          ← stage ① OCR
    ├── extract_meta.py      ← stage ② metadata extract
    ├── chunk.py             ← stage ③ chunking
    ├── vectorize.py         ← stage ④ vectorize
    └── build_kb.py          ← one-command orchestrator
```

### 9. FAQ

**Q: Where does the Python virtual environment go, and how do I switch interpreters?**
The simplest path is the **Settings → Knowledge Base → "Set up Python environment"** button — it calls `scripts/setup_env.py` (stdlib only), creates `KnowledgeBase/.venv`, and streams pip's output to the same live log used during a build. Both the CLI (`build_kb.py`) and the web build button auto-detect that venv afterwards. To use a different interpreter (e.g. a conda env you already maintain), set `BP_KB_PYTHON=/abs/path/to/python` before launching BrainPilot — that overrides the auto-detection entirely. To rebuild the venv from scratch click **"Reinstall venv"** (or `bash KnowledgeBase/scripts/setup_env.sh --reinstall`).

**Q: OCR keeps hitting 429 / TPM cap.**
Drop `--ocr-concurrency 2` (or even 1). The script has a process-wide rate-limit gate that already pauses every worker for 70 s after any 429, so further retries succeed without dropping the page.

**Q: Some metadata-extract rows came back as `fallback`.**
Re-run `python scripts/extract_meta.py` — the script auto-retries all fallback records. For specific files: `--target SUBSTR`.

**Q: I added new PDFs — do I have to rebuild everything?**
No. Every stage is incremental: OCR only handles new PDFs; metadata only handles new rows; chunking only touches `mmd_path`s not yet in `chunks.json`; vectorize only embeds `chunk_id`s not yet in `index.json`.

**Q: Retrieval quality is poor.**
First check `vectorstore/meta.json.count` is non-zero. Then raise `min_rerank_score` (default 0.5) to filter out borderline matches. Finally check the query isn't too short or far outside the indexed domain.

**Q: Memory usage?**
bge-m3 + reranker take ~2.5 GB on GPU (fp16), ~4–5 GB on CPU (fp32). The sidecar shuts down when BrainPilot exits, so the steady-state disk cost is just `vectorstore/` + `models/`.

---

## 中文

一套可端到端构建**本地** RAG 领域知识库的工具包：把你的 PDF 拖进 `source/pdf/`，跑一遍 pipeline，BrainPilot 的 agent 立刻就能通过 `get_domain_knowledge_local` 与 `search_papers_local` 两个内置工具检索这些内容。嵌入和重排序模型**都在本机运行**——不用 daemon、不开公网端口、不依赖第三方检索服务。

### 1. 一图理解全流程

```
                                                            ┌──────────────────┐
 source/pdf/*.pdf                                            │  agent runtime  │
        │                                                    │  (TypeScript)   │
        │ ① OCR (SiliconFlow DeepSeek-OCR)                   │                 │
        ▼                                                    │  get_domain_    │
 source/mmd/<title>/<title>.mmd            ┌────────────────►│  knowledge_local│
        │                                  │                 │  search_papers_ │
        │ ② metadata extract (LLM)         │                 │  local          │
        ▼                                  │                 └────────┬────────┘
 source/KB_source.json                     │                          │
        │                                  │                          ▼
        │ ③ chunk (offline, CPU)           │   ④ retrieve = bge-m3 embed +
        ▼                                  │      bge-reranker-v2-m3 rerank
 chunks/chunks.json                        │            │
        │                                  │            ▼
        │ ④ vectorize (bge-m3)             └─── model_server.py (本地 sidecar，
        ▼                                       仅监听 loopback，自动 GPU/MPS/CPU)
 vectorstore/{embeddings.npy,
              chunks.jsonl,
              index.json,
              meta.json}
```

四个阶段相互独立、且都**可重入**：同一份 PDF 不会重 OCR、同一篇 mmd 不会重新切块、同一个 chunk_id 不会重新嵌入。所有路径都以 `KB_ROOT`（默认就是本目录）为根。

### 2. 一键构建（前端按钮版）

最简单的入口是 BrainPilot 主界面的 **Settings → 知识库（Knowledge Base）**：

1. 把 PDF 拷到 `KnowledgeBase/source/pdf/`（面板里会写明路径）。
2. 填 **SiliconFlow OCR API Key**（必填，OCR 阶段使用）。
3. 元数据抽取默认勾选「复用 agent 当前的 LLM key」，会走 BrainPilot 已配置好的 provider。如要用另外的模型，取消勾选后填 `base URL / model / key`。
4. 选择要运行的阶段（默认四个全选）。
5. 点 **构建知识库 / Build Knowledge Base**。

构建过程中阶段进度条与实时日志通过 SSE 持续推到前端；OCR 失败页、metadata fallback、向量化失败 batch 都会高亮显示。**Cancel build** 会向构建进程发 SIGTERM；磁盘上的 `OCRed_pdf.json` / `KB_source.json` / `chunks.json` / `vectorstore/` 都是原子写入的，下次启动可以无缝续跑。

### 3. Python 虚拟环境（只需配置一次，前端按钮也依赖它）

四个构建阶段（PyMuPDF、openai 等）和本地 bge sidecar（PyTorch + FlagEmbedding）都
**需要自己的 venv**。有两种方式创建。

#### 3a. 前端按钮（推荐）

打开 **Settings → 知识库**。如果 `.venv` 还不存在，面板顶部会显示黄色提示条和
**「一键配置 Python 环境」** 按钮。点一下，后端会 spawn `scripts/setup_env.py`
（纯 stdlib，能跑在任何 PATH 上的 Python），在 `KnowledgeBase/.venv` 创建虚拟环境，
并把 pip 的实时进度推到下方日志面板。2-5 分钟后提示条变绿，**「构建知识库」** 按钮自动可点。

venv 存在后面板里还有一个小一点的 **「重建虚拟环境」** 按钮，依赖升级卡住时可以用。

#### 3b. 命令行

```bash
# Linux / macOS
bash KnowledgeBase/scripts/setup_env.sh

# Windows（PowerShell / cmd）
KnowledgeBase\scripts\setup_env.bat

# 跨平台 stdlib 版（前端按钮调用的就是这个）
python KnowledgeBase/scripts/setup_env.py
```

Shell 脚本会自动选择 `PATH` 上最新的 Python ≥ 3.10。要指定特定解释器：
`setup_env.sh --python /opt/python3.11/bin/python3`。

`.venv` 一旦存在，**前端「构建知识库」按钮和 CLI `build_kb.py` 都会自动发现并使用它** ——
无需 `source .venv/bin/activate`、也无需任何环境变量。自动发现优先级：

1. `BP_KB_PYTHON` 环境变量（如果你想用别的 conda env 等位置）
2. `<KB_ROOT>/.venv/bin/python`（Unix）/ `\.venv\Scripts\python.exe`（Windows）——
   就是 `setup_env` 产物
3. `PYTHON` 环境变量
4. `PATH` 上的 `python3` / `python`（兜底；后端会主动拒绝这种情况下的构建，因为
   依赖一般不在系统级 site-packages 里）

如果你已经有一个 conda env / 系统级安装想复用，启动 BrainPilot 前
设置 `BP_KB_PYTHON=/abs/path/to/python` 即可绕过 venv 检查。

### 4. 命令行版

```bash
# 1.（一次性）创建 venv（见 §3）
bash KnowledgeBase/scripts/setup_env.sh

# 2.（一次性）下载嵌入 + 重排序模型权重（约 2.5 GB）
KnowledgeBase/.venv/bin/python KnowledgeBase/scripts/setup_models.py
#   国内用户：--hf-mirror https://hf-mirror.com

# 3. 把 PDF 放进 source/pdf/，然后一把梭：
export SILICONFLOW_API_KEY=sk-...
export META_LLM_API_KEY=sk-...
export META_LLM_BASE_URL=https://api.example.com
export META_LLM_MODEL=deepseek-chat
python KnowledgeBase/scripts/build_kb.py
# （build_kb.py 会自动把后续 stage 交给 .venv/bin/python；外层这个 python
#   不需要装 requirements.txt 里的依赖。）
```

也可以只跑某些阶段：

```bash
python KnowledgeBase/scripts/build_kb.py --skip-ocr               # mmd 已经在
python KnowledgeBase/scripts/build_kb.py --only chunk vectorize   # 只重切+重嵌
```

每个阶段都有独立脚本可单独运行：

| 脚本 | 输入 | 输出 |
|------|------|------|
| `scripts/ocr_pdfs.py` | `source/pdf/*.pdf` | `source/mmd/<title>/*.mmd`、`source/OCRed_pdf.json` |
| `scripts/extract_meta.py` | `source/OCRed_pdf.json` | `source/KB_source.json` |
| `scripts/chunk.py` | `source/KB_source.json` | `chunks/chunks.json` |
| `scripts/vectorize.py` | `chunks/chunks.json` | `vectorstore/{embeddings.npy, chunks.jsonl, index.json, meta.json}` |

加 `--json` 任何脚本都会把每条进度事件用 NDJSON 一行一条打到 stdout，便于上层 orchestrator 解析（前端面板就是这么用的）。

### 5. API key 与配置

构建期间脚本按 **CLI 参数 → 环境变量 → `source/API_config.json`** 的优先级解析 key。

- **OCR**：`SILICONFLOW_API_KEY`（脚本只用 SiliconFlow 的 DeepSeek-OCR 模型）。
- **Metadata 抽取**：任意 OpenAI 兼容端点。环境变量为 `META_LLM_API_KEY` / `META_LLM_BASE_URL` / `META_LLM_MODEL`。

`source/API_config.json` 示例（可选；只是为了避免每次都 export 环境变量）：

```json
{
  "siliconflow": { "API_KEY": "sk-..." },
  "meta_extract": {
    "BASE_URL": "https://api.example.com",
    "API_KEY":  "sk-...",
    "MODEL":    "deepseek-chat"
  }
}
```

> 该文件已经在 `.gitignore` 中，不会被误提交。

嵌入和重排序模型**始终在本机运行**，不需要任何 key。

### 6. 暴露给 agent 的两个工具

构建完成后，BrainPilot runtime 会自动为所有非 trace 角色注册两个 system tool：

#### `get_domain_knowledge_local(query, topk=5, min_rerank_score=0.5) -> str`

按自然语言问题做两阶段检索：

1. 用 bge-m3 给 query 取 dense vector；
2. 对 `embeddings.npy` 做 cosine top-(topk × 10) 召回；
3. 把这些候选送 bge-reranker-v2-m3 精排；
4. 返回精排分数 ≥ `min_rerank_score` 的前 `topk` 段，拼成多段字符串，每段含 title / authors / journal / date / chunk 位置 / 段落正文。

任何错误（KB 没建、sidecar 启不起来、模型权重缺失、向量库损坏）都会以 `"ERROR: ..."` 字符串返回，不抛异常。

#### `search_papers_local(title?, authors?, journal?, published_year?, keywords?, topk=5, mode=meta-data, segment=1) -> str`

按元数据过滤 + 关键词排序检索 `KB_source.json`：

- `mode="meta-data"` 返回 JSON 元数据列表（附 `keyword_hits`）。
- `mode="full-paper"` 额外返回一段 mmd 全文片段（默认每段 ~20k 字符）+ `segment_info`，可用 `segment` 翻页。

所有内部字段（`mmd_path`、`extraction_status`）都从返回结果中剥离，不会泄漏给 agent。

⚠️ 注意所有过滤参数都是**完全匹配**：`journal="Nat Commun"` 不会命中 `"Nature Communications"`；`published_year=2020` 会排除掉 `published_date` 为空的条目。不确定时优先用 `keywords` 排序、把过滤参数留空。

### 7. 模型本地化部署细节

- 权重保存在 `models/bge-m3/` 与 `models/bge-reranker-v2-m3/`，由 `scripts/setup_models.py` 从 HuggingFace 下载（约 2.5 GB；可断点续传）。
- 推理时由一个**单用户 loopback sidecar** —— `server/model_server.py` —— 在 runtime 第一次检索调用时**自动 spawn**，BrainPilot 进程退出时一起干净退出（SIGTERM）。
  - 不是 systemd daemon、不监听公网、不需要 nginx / docker。
  - sidecar 自动选 GPU → MPS → CPU，并启用 fp16（CPU 上回退到 fp32）。
- 如果你已经在别处跑着一个 bge 服务，可设置 `BP_KB_SERVER_URL=http://<host>:<port>` 让 runtime 跳过 spawn、直接复用。
- 离线场景：先用 `setup_models.py` 下好权重，断网后 `build_kb.py --skip-ocr --skip-extract`（OCR/抽取需要联网）仍可重切重嵌。

### 8. 目录布局

```
KnowledgeBase/
├── README.md                ← 本文档
├── requirements.txt
├── .gitignore               ← 把 PDF/mmd/向量库/模型权重全排除
│
├── .venv/                   ← scripts/setup_env.sh 创建（已 gitignored）
│
├── source/
│   ├── pdf/                 ← 你放 PDF 的地方
│   ├── mmd/                 ← OCR 产出的 markdown（每篇一个子目录）
│   ├── OCRed_pdf.json       ← OCR 进度账本
│   ├── KB_source.json       ← 元数据库（agent 可检索）
│   └── API_config.json      ← 可选的 key 配置（gitignored）
│
├── chunks/
│   └── chunks.json          ← 切块结果（增量）
│
├── vectorstore/
│   ├── embeddings.npy       ← float32 (N, 1024) L2-normalized
│   ├── chunks.jsonl         ← 每行一个 chunk，行序与 embeddings 行序一致
│   ├── index.json           ← chunk_id → row index
│   └── meta.json            ← {dim, model, count, updated_at, normalized}
│
├── models/
│   ├── bge-m3/              ← setup_models.py 自动下载
│   └── bge-reranker-v2-m3/  ← setup_models.py 自动下载
│
├── server/
│   └── model_server.py      ← 单用户 loopback sidecar
│
└── scripts/
    ├── _common.py           ← 共享路径 + NDJSON 事件
    ├── setup_env.py         ← 创建 .venv 并装依赖（跨平台；前端按钮调用的就是这个）
    ├── setup_env.sh         ← Linux / macOS shell 包装
    ├── setup_env.bat        ← Windows shell 包装
    ├── setup_models.py      ← 下载 bge 嵌入 + 重排序权重
    ├── ocr_pdfs.py          ← 阶段 ① OCR（SiliconFlow API）
    ├── extract_meta.py      ← 阶段 ② 元数据抽取
    ├── chunk.py             ← 阶段 ③ 切块
    ├── vectorize.py         ← 阶段 ④ 向量化
    └── build_kb.py          ← 一把梭 orchestrator
```

### 9. 常见问题

**Q: Python 虚拟环境放在哪？怎么切换解释器？**
A: 最方便的是 **Settings → 知识库 → 「一键配置 Python 环境」** 按钮 —— 它会调用 `scripts/setup_env.py`（纯 stdlib），在 `KnowledgeBase/.venv` 创建虚拟环境，并把 pip 的输出实时推到同一个日志面板。CLI（`build_kb.py`）与前端构建按钮之后都会自动发现这个 venv。如果想换成你已有的别的解释器（例如自己维护的 conda env），启动 BrainPilot 前设置 `BP_KB_PYTHON=/abs/path/to/python` 即可彻底覆盖自动发现。需要从头重建 venv 点 **「重建虚拟环境」** 按钮（或 `bash KnowledgeBase/scripts/setup_env.sh --reinstall`）。

**Q: OCR 报 429 (TPM 限制)？**
A: `--ocr-concurrency 2` 降并发；脚本内部有进程级 rate-limit gate，会把所有 worker 一起 pause 70s，因此即使继续撞 429 也不会真正失败。

**Q: 元数据抽取偶尔失败（fallback 行）？**
A: 重跑 `python scripts/extract_meta.py` 会自动重试所有 fallback 记录；针对特定文件可加 `--target SUBSTR`。

**Q: 我增量新增了 PDF，需要重建全部索引吗？**
A: 不需要。`build_kb.py` 每一步都是增量的：OCR 只 OCR 新 PDF；元数据只抽取新条目；切块和向量化只处理 `chunk_id` 未在 store 里的新块。

**Q: 检索质量很差怎么办？**
A: 先确认 `vectorstore/meta.json.count` 不是 0；其次提高 `min_rerank_score`（默认 0.5）筛掉低质量；最后看 query 是不是太短或者跟语料无关。

**Q: 内存吃太多？**
A: bge-m3 + reranker 在 GPU 上 fp16 大约占 2.5 GB；CPU fp32 大约 4-5 GB。sidecar 会随 BrainPilot 主进程一起退出，稳定态磁盘开销 ≈ `vectorstore/` + `models/`。
