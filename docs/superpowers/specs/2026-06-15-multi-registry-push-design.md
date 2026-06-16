# 多镜像源推送机制 — 设计文档

- **日期**: 2026-06-15
- **状态**: 设计已确认，待写实现计划
- **范围**: BrainPilot Docker 镜像的构建与多 registry 推送机制，含 cpu/gpu sandbox 变体的依赖设计

---

## 1. 背景与目标

BrainPilot 当前有 Docker 镜像构建（`docker/main/Dockerfile`、`docker/sandbox/Dockerfile`）和
本地构建脚本 `scripts/release-build.sh`，但**没有任何镜像推送机制**——README 只有 npm 发布流程，
CI 无镜像推送 workflow。

本设计要解决：

1. 把镜像**推送到三个 registry**（公开分发 + 国内加速 + 内网部署）。
2. 从同一套源产出**三个镜像**：`main`、`sandbox`（cpu）、`sandbox-gpu`。
3. 镜像版本号**与 npm 版本一致**（根 `package.json` 的 `version`，由 `scripts/sync-versions.js` 维护）。
4. 触发方式为**本地脚本**（非 CI）——因为内网 registry 只能从可访问内网的机器推。
5. 开源仓库**不泄露**私有基础设施地址（ACR 实例 ID、内网 IP）。

### 1.1 推送目标矩阵

| 镜像 | ghcr.io（owner `neuroaihub`） | ACR（命名空间 `brainpilot`） | 内网（insecure registry） |
|------|------|------|------|
| main | `ghcr.io/neuroaihub/brainpilot-main` | `crpi-…cn-beijing.personal.cr.aliyuncs.com/brainpilot/main` | `10.0.3.125:5000/brainpilot-main` |
| sandbox (cpu) | `…/brainpilot-sandbox` | `…/brainpilot/sandbox` | `…/brainpilot-sandbox` |
| sandbox-gpu | `…/brainpilot-sandbox-gpu` | `…/brainpilot/sandbox-gpu` | `…/brainpilot-sandbox-gpu` |

- ghcr / 内网为**扁平命名**（`brainpilot-<组件>`，无命名空间层）。
- ACR 有命名空间层 `brainpilot`，故仓库名取**短名**（`main`/`sandbox`/`sandbox-gpu`），与控制台已建仓库对应。
- 每个镜像打两个 tag：`<version>`（当前 `0.0.3`）+ `latest`。

### 1.2 认证状态（前置条件，不在脚本内处理）

凭证靠**预先 `docker login`**，存于 `/root/.docker/config.json`（不在仓库内、不进设计文件）。

| Registry | 认证 | 已登录账号 |
|----------|------|-----------|
| ghcr.io | `docker login` | `GTC2333` |
| crpi-…cn-beijing.personal.cr.aliyuncs.com | `docker login` | `gtc23333` |
| 10.0.3.125:5000 | insecure registry，免登录（daemon.json 已配 `insecure-registries`） | — |

> ghcr 与 ACR 是两个不同账号，注意区分。

---

## 2. 总体架构

三个关注点，独立、清晰接口衔接：

```
┌─────────────────────┐   ┌──────────────────────┐   ┌─────────────────────┐
│  1. 镜像清单 (SSOT)  │ → │  2. 构建 (build)      │ → │  3. 推送 (push)     │
│  release-images.sh  │   │  release-build.sh    │   │  release-push.sh    │
│  + 地址外置 .local   │   │  本地产出 3 个镜像    │   │  fan-out tag/push    │
└─────────────────────┘   └──────────────────────┘   └─────────────────────┘
        声明                    读清单驱动构建              读清单驱动推送
```

**核心原则：单一数据源（SSOT）。** 一份清单声明镜像与 registry，build 与 push 脚本都读它，
不各自硬编码。加镜像 / 加 registry = 改清单一处。

**build 与 push 分离**的理由：

1. 构建慢（main 含 vite build，gpu 含 torch），推送可能因网络重试 —— 分开可单独重跑。
2. 推送是不可逆外向操作，独立脚本便于"先构建验证、再决定推哪些 registry"。
3. 三套 registry 网络条件不同，push 脚本支持只推子集（如 6GB 的 gpu 镜像跳过公网 ghcr）。

---

## 3. 组件一：镜像清单 SSOT（`scripts/release-images.sh`）

被 build/push 脚本 `source`。两张表 + 一个命名映射函数 + 地址外置。

### 3.1 本地镜像清单

```bash
# 格式: "本地镜像名|Dockerfile 路径|额外 build-arg(空格分隔，可空)"
RELEASE_IMAGES=(
  "brainpilot-main|docker/main/Dockerfile|"
  "brainpilot-sandbox|docker/sandbox/Dockerfile|SANDBOX_EXTRA_DEPS=extra-deps.sh"
  "brainpilot-sandbox-gpu|docker/sandbox/Dockerfile|SANDBOX_EXTRA_DEPS=extra-deps.gpu.sh"
)
```

`sandbox` 与 `sandbox-gpu` **共用** `docker/sandbox/Dockerfile`，仅靠 build-arg `SANDBOX_EXTRA_DEPS`
选择 COPY 哪个依赖脚本（见 §6）。

### 3.2 registry 清单 + 地址外置（安全）

```bash
# ghcr 地址本就公开，直接写死在提交版本里
RELEASE_REGISTRIES=( "ghcr|ghcr.io/neuroaihub|flat" )

# ACR 实例 ID / 内网 IP 属"敏感但非机密"，外置到不提交的本地文件
[ -f scripts/release-targets.local.sh ] && source scripts/release-targets.local.sh
```

`scripts/release-targets.local.sh`（**`.gitignore`，不提交**）：

```bash
# 私有推送目标 —— 不提交。复制 release-targets.example.sh 填入真实地址。
RELEASE_REGISTRIES+=( "acr|crpi-t2q2y3ujes80doq8.cn-beijing.personal.cr.aliyuncs.com/brainpilot|acr" )
RELEASE_REGISTRIES+=( "intranet|10.0.3.125:5000|flat" )
```

`scripts/release-targets.example.sh`（**提交**，占位示范）：

```bash
# 复制为 release-targets.local.sh 并填入真实地址。local 文件已被 .gitignore 排除。
RELEASE_REGISTRIES+=( "acr|<实例ID>.cn-<region>.personal.cr.aliyuncs.com/<命名空间>|acr" )
RELEASE_REGISTRIES+=( "intranet|<内网IP>:<端口>|flat" )
```

此模式沿用仓库已有约定（`.env` 私有 + `models.example.json` 占位）。

### 3.3 命名映射函数

```bash
# remote_repo <本地镜像名> <前缀> <风格>
#   flat → 前缀/本地名         (brainpilot-main)
#   acr  → 前缀/去 brainpilot- 前缀的短名  (main)
remote_repo() {
  local local_name="$1" prefix="$2" style="$3"
  case "$style" in
    flat) echo "${prefix}/${local_name}" ;;
    acr)  echo "${prefix}/${local_name#brainpilot-}" ;;
  esac
}
```

映射结果即 §1.1 矩阵（已与 ACR 控制台仓库 `main`/`sandbox`/`sandbox-gpu` 对应）。

### 3.4 为何用 bash 数组而非 JSON/YAML

脚本是 bash、无额外依赖（jq 不一定装）；条目少（3+3）可读性足够；与现有 `scripts/*.sh` 风格一致。

---

## 4. 组件二：build 脚本（`scripts/release-build.sh`）

把现有硬编码两条 build 改为**循环遍历镜像清单**。

```bash
source scripts/release-images.sh
# 镜像源外置（§7.4-pre）：本地文件存在则覆盖官方源默认值
[ -f scripts/release-mirrors.local.sh ] && source scripts/release-mirrors.local.sh
VERSION="$(node -p "require('./package.json').version")"
# 经典构建器：BuildKit 镜像解析器不吃 dockerd 的 systemd 代理、直连被墙的 Docker Hub；
# 经典构建器走守护进程代理路径（已验证 docker pull 可用）。这些 Dockerfile 无 BuildKit 专属语法。
COMMON=( --network=host
         --build-arg "HTTP_PROXY=${PROXY:-}" --build-arg "HTTPS_PROXY=${PROXY:-}"
         --build-arg "NPM_REGISTRY=${NPM_REGISTRY:-}"
         --build-arg "APT_MIRROR=${APT_MIRROR:-}"
         --build-arg "PIP_INDEX_URL=${PIP_INDEX_URL:-}"
         --build-arg "PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL:-}" )

for entry in "${RELEASE_IMAGES[@]}"; do
  IFS='|' read -r name dockerfile extra_arg <<< "$entry"
  # 支持子集：bash release-build.sh sandbox-gpu 只建匹配项（默认全建）
  [ $# -gt 0 ] && ! _matches "$name" "$@" && continue
  extra=(); [ -n "$extra_arg" ] && extra=( --build-arg "$extra_arg" )
  echo "==> building $name (tags: latest, $VERSION)"
  sudo DOCKER_BUILDKIT=0 docker build "${COMMON[@]}" "${extra[@]}" \
    -f "$dockerfile" -t "$name:latest" -t "$name:$VERSION" .
done
```

要点：

- `sudo DOCKER_BUILDKIT=0 docker build` —— 不能用 `export`，`sudo` 会清环境变量。
- `--network=host` 让 RUN 步骤借宿主 Clash 代理（`127.0.0.1:7890`）。
- 镜像源（apt/pip/npm）来自 `release-mirrors.local.sh`（不提交），经 build-arg 注入容器；
  无本地文件则传空、容器内落到官方源默认值。
- 子集构建对 gpu（几 GB、慢）尤其有用。

---

## 5. 组件三：push 脚本（`scripts/release-push.sh`）

把本地已构建镜像 `tag` + `push` 到选定 registry。**不重新构建**，只搬运。

### 5.1 用法

```bash
bash scripts/release-push.sh                                  # 全部镜像 → 全部已配置 registry
bash scripts/release-push.sh --registry acr,intranet          # 只推这两个（跳过公网 ghcr）
bash scripts/release-push.sh --image sandbox-gpu              # 只推某镜像
bash scripts/release-push.sh --image sandbox-gpu --registry acr,intranet  # 组合
bash scripts/release-push.sh --dry-run                        # 只打印 tag/push，不真推
```

`--registry` 子集很重要：**sandbox-gpu 约 6GB，推 ghcr（公网）可能超时**，可只推国内+内网。

### 5.2 核心逻辑

```bash
source scripts/release-images.sh
VERSION="$(node -p "require('./package.json').version")"

for img in <筛选后的本地镜像>; do
  sudo docker image inspect "$img:$VERSION" >/dev/null 2>&1 \
    || { echo "缺 $img:$VERSION，先跑 release-build.sh"; exit 1; }
  for reg in <筛选后的 registry>; do
    IFS='|' read -r key prefix style <<< "$reg"
    repo="$(remote_repo "$img" "$prefix" "$style")"
    for tag in "$VERSION" latest; do
      echo "==> $img:$tag → $repo:$tag"
      [ -n "$DRY_RUN" ] && continue
      sudo docker tag  "$img:$tag" "$repo:$tag"
      sudo docker push "$repo:$tag" || RECORD_FAILURE "$repo:$tag"
    done
  done
done
PRINT_SUMMARY   # 每个 镜像×registry×tag 的成功/失败
```

### 5.3 错误处理

- **本地镜像缺失** → 明确报错"先跑 release-build.sh"，不静默跳过。
- **某 registry push 失败**（网络/超时） → 记录失败项**继续推其他**，结尾汇总；不用全局 `set -e`
  中途退出，避免一个 registry 挂掉前功尽弃。
- **未登录** → docker push 自报 unauthorized；脚本开头可选做 login 状态检查给友好提示。
- **结尾打印推送清单** → 一眼看清推了什么去哪。

### 5.4 安全边界

push 脚本读 `release-images.sh` 的 registry 清单，ACR/内网地址来自不提交的 `release-targets.local.sh`。
开源仓库里的 push 脚本只能看到 ghcr 默认目标，私有地址不泄露（§3.2）。

---

## 6. Dockerfile 改动：sandbox cpu/gpu 变体

`docker/sandbox/Dockerfile` 把写死的 `extra-deps.sh` 改为 build-arg 选择，并把镜像源 build-arg
透传为 ENV 供依赖脚本读取：

```dockerfile
ARG SANDBOX_EXTRA_DEPS=extra-deps.sh          # 默认 cpu 基线，向后兼容现有 compose 构建
ARG APT_MIRROR=""
ARG PIP_INDEX_URL=""
ARG PIP_EXTRA_INDEX_URL=""
# build-arg → ENV，使 extra-deps 脚本能读到镜像源（空则脚本落官方源默认）
ENV APT_MIRROR=${APT_MIRROR} PIP_INDEX_URL=${PIP_INDEX_URL} PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL}
COPY docker/sandbox/${SANDBOX_EXTRA_DEPS} /tmp/extra-deps.sh
RUN chmod +x /tmp/extra-deps.sh && bash /tmp/extra-deps.sh
```

`main` 镜像不变（纯 Node 代理，不跑代码、不需 Python）。

---

## 7. 镜像依赖设计（关键，超出"推送"但直接决定镜像内容）

### 7.1 依赖矩阵（已定）

| 镜像 | 基础 | 运行时入口 | Python | 预装科学库 | torch | 体积估计 |
|------|------|-----------|:---:|:---:|:---:|------|
| **main** | node:22-slim | `backend-core/dist/server.js`（无状态代理） | ❌ | ❌ | ❌ | ~750MB |
| **sandbox** (cpu) | node:22-slim | `runtime/dist/server.js`（Pi SDK） | ✅ python3+pip+venv | ❌ agent 自装 | ❌ | ~280MB |
| **sandbox-gpu** | node:22-slim | 同 sandbox | ✅ python3+pip+venv | ✅ 见 §7.4 | ✅ cu124 | ~6GB |

### 7.2 为何只有 sandbox 系列需要 Python

代码查证（`packages/*/package.json` + `personas.ts` + Pi SDK）：

- **main** 跑 `backend-core`，是 stateless byte-passthrough 代理（CLAUDE.md 修正4），**从不执行用户代码** →
  纯 Node，绝不需要 Python。
- **sandbox** 跑 `runtime` + Pi SDK，**agent 在此执行代码**。Pi SDK 提供 `bash` 工具（`createBashTool`），
  coding persona 明确指示 agent *"Use `write`/`edit` to author files and `bash` to run them"*
  （`personas.ts`）。agent 写 `analysis.py` 后 `bash: python3 analysis.py` —— 当前 cpu 基线是
  `node:22-slim` + no-op extra-deps，**容器内无 `python3`，会 `command not found`**。故 cpu sandbox
  必须装 Python。

> 这是当前代码已存在的缺口：cpu sandbox 的 agent 一写 Python 就失败。本设计一并修复。

### 7.3 node:22-slim vs python:3.12-slim（基础镜像选型说明）

二者同为 Debian slim，仅预装语言运行时不同（node vs python），**并存互不影响**（各自 bin/包管理/依赖目录独立，
仅共享 OS 系统库）。BrainPilot runtime 是 **Node 程序**，故 sandbox 必须以 `node:22-slim` 为底，
再 `apt-get install python3` 加装 Python（GPU 能力是额外叠加）。这与 legacy 相反（legacy runtime 是
Python，故以 `python:3.12-slim` 为底加装 node）—— 架构从 Python 改为 TS，基础镜像主次随之反转。
我们只借用 legacy 的 **torch 版本与镜像源策略**，不借其基础镜像。

> Debian 12+ 系统 Python 标记为 externally-managed，容器内 pip 安装用 `--break-system-packages`
> （容器一次性，不怕"弄脏"系统 Python）。

### 7.4-pre 镜像源外置（模板提交 + 本地实际）

依赖脚本里有两类内容，外置策略不同：

| 内容 | 环境相关 | 处理 |
|------|:---:|------|
| **镜像源**（pip index-url、apt 源） | ✅ | 本地配（国内阿里云/清华，国外官方） |
| **依赖清单**（装哪些包、torch 版本） | ❌ | 单份提交（项目定义，不因机器变，避免漂移） |

**机制**：依赖脚本**单份提交**且不写死阿里云——改用环境变量（`PIP_INDEX_URL` / `PIP_EXTRA_INDEX_URL`
/ `APT_MIRROR`），变量为空时落到**官方源默认值**。变量值由 **build 脚本从本地镜像源文件读取并经
build-arg 注入容器**（容器隔离，无法 source 宿主文件，故必须经 build-arg 传入）。

- `scripts/release-mirrors.example.sh`（**提交**，占位示范）：

  ```bash
  # 复制为 release-mirrors.local.sh 启用国内镜像源加速。local 文件已被 .gitignore 排除。
  # 留空或不创建 local 文件 = 用官方源（pypi.org / deb.debian.org）。
  export PIP_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"
  export PIP_EXTRA_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple/"
  export APT_MIRROR="http://mirrors.aliyun.com"
  ```

- `scripts/release-mirrors.local.sh`（**不提交**）：你的实际镜像源。
- build 脚本：`[ -f scripts/release-mirrors.local.sh ] && source scripts/release-mirrors.local.sh`，
  再把 `PIP_INDEX_URL` 等转为 `--build-arg` 传入（与现有 `NPM_REGISTRY`/`APT_MIRROR` build-arg 同理）。

> 注意：legacy 实测宿主 Clash 代理对 `pypi.org` 的 TLS 在 ClientHello 后被 RST，但阿里云正常。
> 故在本网络环境**实际构建时务必创建 `release-mirrors.local.sh` 指向阿里云**，否则官方源默认值会失败。
> 提交版用官方源默认是为了开源用户在不被墙的网络下开箱可用。

### 7.4 sandbox cpu 依赖脚本（`docker/sandbox/extra-deps.sh`，由 no-op 改为）

装 `python3 + pip + venv`，**不预装**任何科学库（agent 按需自装，persona 本就要求 agent 管理依赖）。
保持 cpu 镜像轻量（~280MB），符合 Dockerfile "lightweight baseline" 注释。镜像源来自注入的环境变量
（§7.4-pre），空则官方源。

```bash
#!/usr/bin/env bash
set -euo pipefail
# apt 源：APT_MIRROR 注入则替换，否则用镜像自带官方源
[ -n "${APT_MIRROR:-}" ] && sed -i "s|http://deb.debian.org|$APT_MIRROR|g" \
  /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null || true
apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv
rm -rf /var/lib/apt/lists/*
# pip 源：注入则固化，否则不写 /etc/pip.conf（用 pip 官方默认 pypi.org）
if [ -n "${PIP_INDEX_URL:-}" ]; then
  { echo '[global]'; echo "index-url = ${PIP_INDEX_URL}";
    [ -n "${PIP_EXTRA_INDEX_URL:-}" ] && echo "extra-index-url = ${PIP_EXTRA_INDEX_URL}";
    echo 'timeout = 60'; } > /etc/pip.conf
fi
```

### 7.5 sandbox-gpu 依赖脚本（`docker/sandbox/extra-deps.gpu.sh`，新增）

= cpu 的 Python 基础 + **预装科学/PDF 栈** + **CUDA torch cu124**。

**预装清单（已定，方案 A）**：

- 数值/数据：`numpy pandas scipy`
- 可视化：`matplotlib`
- 机器学习：`scikit-learn`
- PDF：`pypdf`（纯文本）+ `pdfplumber`（表格）
- 图像：`pillow`

**版本策略**：`torch` 钉死 `2.5.1+cu124`（CUDA 必须精确匹配）；科学库装最新稳定不钉（向后兼容好）。
**不含** transformers/HuggingFace 栈。

torch 版本/源沿用 legacy 实测配置（`legacy/docker/agent_runtime/Dockerfile.base`，2026-05-29 实测）：

```bash
#!/usr/bin/env bash
set -euo pipefail
# ---- 1. python3 + pip + 镜像源（与 cpu 脚本同逻辑，实现时抽 _python-base.sh 共享避免重复）----
[ -n "${APT_MIRROR:-}" ] && sed -i "s|http://deb.debian.org|$APT_MIRROR|g" \
  /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null || true
apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv
rm -rf /var/lib/apt/lists/*
if [ -n "${PIP_INDEX_URL:-}" ]; then
  { echo '[global]'; echo "index-url = ${PIP_INDEX_URL}";
    [ -n "${PIP_EXTRA_INDEX_URL:-}" ] && echo "extra-index-url = ${PIP_EXTRA_INDEX_URL}";
    echo 'timeout = 60'; } > /etc/pip.conf
fi

# ---- 2. 科学/PDF 栈（最新稳定，走上面配置的 pip 源）----
pip3 install --break-system-packages \
  numpy pandas scipy matplotlib scikit-learn pillow pypdf pdfplumber

# ---- 3. CUDA 12.4 runtime wheels（pip 默认源，国内由 release-mirrors.local 指向清华/阿里云）----
pip3 install --break-system-packages \
  nvidia-cuda-runtime-cu12==12.4.127 nvidia-cuda-nvrtc-cu12==12.4.127 \
  nvidia-cudnn-cu12==9.1.0.70 nvidia-cublas-cu12==12.4.5.8 \
  nvidia-cufft-cu12==11.2.1.3 nvidia-curand-cu12==10.3.5.147 \
  nvidia-cusolver-cu12==11.6.1.9 nvidia-cusparse-cu12==12.3.1.170 \
  nvidia-nccl-cu12==2.21.5 nvidia-nvtx-cu12==12.4.127 nvidia-nvjitlink-cu12==12.4.127

# ---- 4. PyTorch cu124（官方 whl 源——清华 pytorch-wheels 不同步 cu124 会 404；
#      此 index-url 是 torch 专属、不受镜像源外置影响。构建时 --network=host 借宿主 Clash 代理）----
pip3 install --break-system-packages \
  torch==2.5.1+cu124 torchvision==0.20.1+cu124 torchaudio==2.5.1+cu124 \
  --index-url https://download.pytorch.org/whl/cu124 \
  --extra-index-url "${PIP_INDEX_URL:-https://pypi.org/simple/}"
```

> GPU 运行期访问显卡靠 `docker run --gpus all`（nvidia runtime），与镜像无关；torch cu124 wheel
> 自带 CUDA 运行库，故基础镜像无需 CUDA 镜像。

---

## 8. 文件清单

| 文件 | 动作 | 说明 |
|------|------|------|
| `scripts/release-images.sh` | 新增 | SSOT 清单：镜像表 + registry 表 + `remote_repo()` + source local |
| `scripts/release-targets.example.sh` | 新增（提交） | ACR/内网占位示范 |
| `scripts/release-targets.local.sh` | 新增（**不提交**） | 真实 ACR/内网地址 |
| `scripts/release-mirrors.example.sh` | 新增（提交） | 镜像源占位示范（pip/apt） |
| `scripts/release-mirrors.local.sh` | 新增（**不提交**） | 真实镜像源（阿里云/清华） |
| `scripts/release-build.sh` | 改造 | 循环读清单 + 子集构建 + 注入镜像源 build-arg（已有原型，重构） |
| `scripts/release-push.sh` | 新增 | 子集筛选 + dry-run + 缺镜像检查 + 失败汇总 |
| `docker/sandbox/Dockerfile` | 改 | `ARG SANDBOX_EXTRA_DEPS` 选依赖脚本 + 镜像源 ARG→ENV 透传 |
| `docker/sandbox/extra-deps.sh` | 改 | no-op → python3+pip+venv（cpu 基线，镜像源变量化） |
| `docker/sandbox/extra-deps.gpu.sh` | 新增 | python3 + 科学/PDF 栈 + torch cu124（镜像源变量化） |
| `.gitignore` | 改 | 加 `scripts/release-targets.local.sh`、`scripts/release-mirrors.local.sh` |
| `README.md` | 改 | 加"Docker 镜像发布"小节（镜像版本号 = npm 版本） |

---

## 9. 验证方式

1. **build 子集**：`bash scripts/release-build.sh sandbox` 只建 cpu sandbox，验证 python3 装入
   （`docker run --rm brainpilot-sandbox:latest python3 --version`）。
2. **dry-run push**：`bash scripts/release-push.sh --dry-run` 打印全部 tag/push 计划，核对三 registry 路径。
3. **真推子集**：`bash scripts/release-push.sh --image main --registry acr` 先推一个最小目标验证认证。
4. **gpu 单独**：gpu 镜像体积大、构建慢，单独 `bash scripts/release-build.sh sandbox-gpu` 验证 torch
   导入（`docker run --rm brainpilot-sandbox-gpu:latest python3 -c "import torch; print(torch.__version__)"`）。
5. **现有 compose 不回归**：`docker compose build` 默认 build-arg 走 cpu 基线，行为不变。

---

## 10. 范围外（不在本设计）

- **CI 自动推送**：本期为本地脚本。内网 registry 决定至少一份必须本地推；以后可把脚本搬进 workflow。
- **GPU 运行期编排**：`--gpus all` / compose GPU 配置不在本设计（仅负责把 gpu 镜像构建+推送出去）。
- **npm 包发布**：已有 `npm run release` 流程，不动。
- **registry 镜像清理/保留策略**：旧 tag 清理不在本期。
