# BrainPilot Docker 构建方法与规范

> 面向 BrainPilot 三镜像（main / sandbox / sandbox-gpu）的构建、发布操作手册。
> 本文档记录的约束多为**实测结论**（带 ✅ 实证标记），照做可避开已知坑。
>
> 关联：依赖瘦身依据见 [`docs/research/2026-06-16-gpu-sandbox-slimming.md`](../research/2026-06-16-gpu-sandbox-slimming.md)。

---

## 1. 镜像清单

| 镜像 | Dockerfile | target | 内容 | 大致大小(解压/压缩) | 推送目标 |
|------|-----------|--------|------|------|---------|
| `brainpilot-main` | `docker/main/Dockerfile` | —(无) | 前端 + backend-core | 758MB / 141MB | ghcr + ACR + 内网 |
| `brainpilot-sandbox` | `docker/sandbox/Dockerfile` | `cpu` | node + python 基线（无科学库） | 849MB / 163MB | ghcr + ACR + 内网 |
| `brainpilot-sandbox-gpu` | `docker/sandbox/Dockerfile` | `gpu` | + 科学栈 + CUDA12.4 + torch2.6 | 9.25GB / 3.18GB | **仅 ACR**(太大,不推 ghcr/内网) |

`sandbox` 与 `sandbox-gpu` **共用同一 Dockerfile**，靠 `--target cpu` / `--target gpu` 切换。

---

## 2. 构建器选择与代理约束（必读）

### 强制经典构建器 `DOCKER_BUILDKIT=0`

✅ **实测**：BuildKit 的镜像 metadata 解析器（`load metadata for docker.io/...`）**不走 dockerd 的 systemd HTTP 代理**，直连被墙的 `auth.docker.io` → 超时失败。`--build-arg HTTP_PROXY` 只对 `RUN` 步骤生效，对"解析基础镜像"这一步无效。

经典构建器走 dockerd 的守护进程代理路径（已配在 systemd），可正常 pull 墙外基础镜像。**所以全程用 `DOCKER_BUILDKIT=0`。**

### `sudo` 清环境变量 → `DOCKER_BUILDKIT=0` 必须内联

`sudo` 默认清除环境变量，`export DOCKER_BUILDKIT=0` 不会传进去。必须内联：

```bash
sudo DOCKER_BUILDKIT=0 docker build ...   # ✅
export DOCKER_BUILDKIT=0; sudo docker build ...   # ❌ 不生效，会走 BuildKit
```

### 代理地址

`release-build.sh` 用 `BUILD_PROXY`（默认 `http://127.0.0.1:7890`，本机 Clash）。dockerd 的 systemd 代理也指向它（`/etc/systemd/system/docker.service.d/*.conf`）。

---

## 3. 为什么不用 `FROM ${ARG}`

✅ **实测**：经典构建器**不支持**用 build-arg 当 `FROM` 的基础镜像名，报：

```
base name (${SANDBOX_BASE}) should not be blank
```

BuildKit 支持（且 ARG 须声明在所有 FROM 之前的全局区），但 BuildKit 又有上面的代理 pull 问题。两者不可兼得。

**结论**：sandbox 用**线性多 stage + `--target`** 区分 cpu/gpu，不用 `FROM ${ARG}`。代价是业务层 6 行（COPY×3 + ENV + EXPOSE + HEALTHCHECK + CMD）在 cpu/gpu 两 stage **各写一份**——父 stage 不同，ENV/CMD/HEALTHCHECK 无法跨非父 stage 继承。**改业务层时务必同步改两处**。真正的 SSOT 是 monorepo 源码 + extra-deps 脚本。

### ⚠️ 经典构建器的 stage 顺序陷阱（关键实证）

✅ **实测**：经典构建器（`DOCKER_BUILDKIT=0`）**按 Dockerfile 文本顺序执行到 `--target` 指定的 stage，不做 BuildKit 那样的依赖图剪枝**。即 `--target X` 会执行**文本上位于 X 之前的所有 stage**，无论它们是否是 X 的依赖。

后果（曾踩）：若 `gpu-base`（装 torch）的文本位置在 `cpu` **之前**，则 `--target cpu` 会**误执行 gpu-base 的 torch 安装**。

**铁律：`cpu` stage 必须排在 `gpu-base` 之前。** 当前 Dockerfile 顺序：
`builder → python-baseline → cpu → gpu-base → gpu`。
- `--target cpu` → 执行到 cpu 即止，不碰 torch。
- `--target gpu`（文本最末）→ 会先执行 cpu stage（含 COPY monorepo，无害冗余）再 gpu-base + gpu。
- gpu-base `FROM python-baseline`（父是 python-baseline，非 cpu），故 cpu 的 monorepo 层失效**不影响** gpu-base 缓存键 → 发版时 torch 仍命中缓存（核心收益不受顺序影响）。

> 这是经典构建器与 BuildKit 的本质差异。改 stage 顺序前务必重读本节。

---

## 4. 镜像分层结构

```
node:22-slim ──> builder            npm ci + tsc -b packages/runtime
node:22-slim ──> python-baseline    _python-base.sh (python3+pip+curl+镜像源)
                   ├──> cpu          + extra-deps.sh + 业务层      → brainpilot-sandbox
                   └──> gpu-base     + extra-deps.gpu-libs.sh (sci+cuda+torch)
                          └──> gpu   + 业务层                       → brainpilot-sandbox-gpu
```
> 注：cpu 与 gpu-base 在 Dockerfile 中的**文本顺序是 cpu 在前**（见 §3 陷阱），上图按依赖关系画，二者均 `FROM python-baseline`。

### gpu-base 的设计目的（核心）

torch/cuda（~2.7GB）放在 `gpu-base` 中间 stage，**位于 monorepo 业务层 `COPY` 之下**。因此：

- **发版**（monorepo 代码变更）→ `builder` 层 + cpu/gpu 的 `COPY --from=builder` 层失效，但 `python-baseline` / `gpu-base` 层**命中缓存** → torch 不重装 → GPU 构建从分钟级降到秒级。
- 旧结构里 torch 在业务层**之上**，每次发版都重装 2.7GB（走交大镜像 3–5 分钟）。这正是本次重构要解决的问题。

> 重构**不改变镜像总大小**（只移动层顺序）；收益是**发版构建速度**，不是减肥。

---

## 5. build-arg 含义

| build-arg | 作用 | 注入 stage | 为空时 |
|-----------|------|-----------|-------|
| `NPM_REGISTRY` | npm 源 | builder | 官方 registry.npmjs.org |
| `HTTP_PROXY`/`HTTPS_PROXY` | RUN 步骤代理 | builder | 无代理 |
| `APT_MIRROR` | apt 源（替换 deb.debian.org） | python-baseline | 官方 deb.debian.org |
| `PIP_INDEX_URL`/`PIP_EXTRA_INDEX_URL` | pip 源（写 /etc/pip.conf） | python-baseline | 官方 pypi.org |
| `TORCH_WHEEL_BASE` | torch wheel 源根 | gpu-base | 上海交大 cu124 镜像 |

镜像源外置在 `scripts/release-mirrors.local.sh`（**不提交**，gitignore）；存在则 `release-build.sh` source 之，覆盖官方源默认值。

---

## 6. release 脚本用法

三脚本均 source `release-images.sh`（SSOT 清单）。

### release-images.sh（清单）

```bash
RELEASE_IMAGES=( "本地镜像名|Dockerfile路径|构建target(可空)" ... )
RELEASE_REGISTRIES=( "registry键|前缀|命名风格(flat|acr)" ... )
```
`remote_repo()`：`flat` → `前缀/本地名`；`acr` → `前缀/去brainpilot-前缀`。私有目标（ACR 实例/内网 IP）在 `release-targets.local.sh`（不提交）append。

### release-build.sh

```bash
bash scripts/release-build.sh                 # 全部
bash scripts/release-build.sh sandbox         # 子串匹配
bash scripts/release-build.sh main sandbox-gpu# 多子集
```
打 `latest` + 版本号(= 根 package.json version)两 tag。

⚠️ **子串匹配陷阱**：`sandbox` 同时匹配 `brainpilot-sandbox` **和** `brainpilot-sandbox-gpu`（都建）。只要 cpu 用 `--image`/参数更精确，或单独 `release-build.sh sandbox-gpu`。

### release-push.sh

```bash
bash scripts/release-push.sh --image sandbox --registry acr --dry-run
```
`--image` 子串匹配（同上陷阱）；`--registry` 精确 CSV；`--dry-run` 只打印。推 VERSION + latest 两 tag。`set -uo pipefail`（非 -e，单 registry 失败继续推其他 + 结尾汇总）。
⚠️ GPU（sandbox-gpu）**只推 ACR**，勿推 ghcr/内网。

---

## 7. gpu-base 缓存机制

- **不进 RELEASE_IMAGES、不打 tag、不推送**——仅构建期本地缓存加速，非交付物。
- **命中条件**：指令字符串 + 父层 ID + `COPY` 内容哈希 + 相关 build-arg 全一致 → `Using cache`。✅ 实测持久（跨 `docker build` 调用）。
- **失效条件**：改 `extra-deps.gpu-libs.sh` / `_python-base.sh` 内容、改 `APT_MIRROR`/`PIP_INDEX_URL`/`TORCH_WHEEL_BASE` build-arg、`docker system prune` / `docker builder prune`。**日常发版不触发。**
- **如何确认命中**：
  ```bash
  bash scripts/release-build.sh sandbox-gpu 2>&1 | grep -E "Using cache|extra-deps.gpu"
  # 期望 extra-deps.gpu-libs.sh 那条 RUN 显示 "Using cache"
  ```

---

## 8. torch/cuda 下载链路

✅ **实测**：官方 `download.pytorch.org` 把 torch wheel 302 到 Cloudflare R2，经 Clash 代理限速崩溃 + 哈希不匹配（连两次构建在 ~908MB torch 处失败）。pip `--index-url` 指交大也没用（交大 simple 索引登记的也是 R2 URL）。

**解法**：拼交大 wheel **文件** URL `https://mirror.sjtu.edu.cn/pytorch-wheels/cu124/<wheel>` → 302 到交大自有 S3（`s3.jcloud.sjtu.edu.cn`，国内 ~13MB/s），绕开 R2 与代理。`extra-deps.gpu-libs.sh` curl 直下三 wheel 再 pip 装本地文件；torch 的纯 Python 依赖仍走 PIP_INDEX_URL。

- `%2B` 是 `+` 的 URL 编码（`torch-2.6.0%2Bcu124-...`），落地文件名 sed 解码回 `+`。
- 源根可被 `TORCH_WHEEL_BASE` 覆盖（默认交大）。

---

## 9. 常见坑

1. **PEP 668 externally-managed**：`pip install` **和** `pip uninstall` 都需 `--break-system-packages`。✅ 实测 uninstall 缺它会**静默拒绝**（无报错、包还在，triton 曾漏卸一次）。
2. **triton**：torch 硬依赖但仅 torch.compile/自定义 kernel 用，本沙盒不需要，卸掉省 ~0.69GB。
3. **sandbox 子串匹配 -gpu**：见 §6。
4. **HEALTHCHECK 依赖 curl**：curl 现装在 `_python-base.sh`（cpu/gpu 共享层），勿删。
5. **python 版本绑死**：wheel 标签 `cp311`、triton 清理路径 `dist-packages/python3.11` 都假定 Python 3.11（node:22-slim = Debian bookworm）。换 base 镜像须同步这些。
6. **cusparselt**：torch 2.6.0 新增独立依赖（2.5.1 时 bundle 在 torch/lib）；`extra-deps.gpu-libs.sh` §2 钉版清单漏补则 `import torch` 缺库崩。
7. **版本号** = 根 `package.json` 的 version；旧本地镜像可能是老版本，发布前须重建。

---

## 10. 快速参考

```bash
# 构建全部
bash scripts/release-build.sh

# 只重建 GPU（torch 命中缓存，秒级）
bash scripts/release-build.sh sandbox-gpu

# 推 cpu + main 到全部 registry（GPU 单独推 ACR）
bash scripts/release-push.sh --image main
bash scripts/release-push.sh --image sandbox --registry acr   # 注意会含 gpu

# 验证 GPU 镜像功能
sudo docker run --rm brainpilot-sandbox-gpu:latest python3 -c \
  "import torch,scipy,pandas,sklearn; print(torch.__version__)"
```
