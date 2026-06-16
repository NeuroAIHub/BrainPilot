# 多镜像源推送机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 BrainPilot 三个 Docker 镜像（main / sandbox / sandbox-gpu）建立 SSOT 清单驱动的本地构建与多 registry（ghcr / ACR / 内网）推送机制，并修复 cpu sandbox 缺 Python 的缺口、新增 GPU 变体，镜像源外置为"模板提交 + 本地私有"。

**Architecture:** 一份 bash 清单 `release-images.sh` 声明镜像与 registry（SSOT），build/push 两个脚本都 source 它。私有信息（ACR 实例 ID、内网 IP、镜像源）外置到 `.local.sh`（gitignore），提交版只含公开默认值。sandbox 的 cpu/gpu 变体共用一个 Dockerfile，靠 build-arg `SANDBOX_EXTRA_DEPS` 选不同依赖脚本；依赖脚本单份提交、镜像源经 build-arg→ENV 变量化注入。

**Tech Stack:** Bash 脚本、Docker 经典构建器（`DOCKER_BUILDKIT=0`）、Node（读 package.json version）、Debian slim 基础镜像 + pip。

参考 spec：`docs/superpowers/specs/2026-06-15-multi-registry-push-design.md`

---

## 文件结构

| 文件 | 责任 |
|------|------|
| `scripts/release-images.sh` | SSOT：镜像表 `RELEASE_IMAGES`、registry 表 `RELEASE_REGISTRIES`、`remote_repo()` 映射函数；source 私有 targets/mirrors |
| `scripts/release-targets.example.sh` | 提交。ACR/内网 registry 条目占位示范 |
| `scripts/release-targets.local.sh` | 不提交。真实 ACR/内网地址 |
| `scripts/release-mirrors.example.sh` | 提交。pip/apt 镜像源占位示范 |
| `scripts/release-mirrors.local.sh` | 不提交。真实镜像源（阿里云/清华） |
| `scripts/release-build.sh` | 改造：source 清单+镜像源 → 循环构建（支持子集）→ 注入镜像源 build-arg |
| `scripts/release-push.sh` | 新增：source 清单 → 解析 `--image`/`--registry`/`--dry-run` → tag+push → 失败汇总 |
| `docker/sandbox/Dockerfile` | 改：`ARG SANDBOX_EXTRA_DEPS` 选脚本 + 镜像源 ARG→ENV 透传 |
| `docker/sandbox/_python-base.sh` | 新增：cpu/gpu 共享的 python3+pip+镜像源安装段（DRY） |
| `docker/sandbox/extra-deps.sh` | 改：no-op → source `_python-base.sh`（cpu 基线） |
| `docker/sandbox/extra-deps.gpu.sh` | 新增：source `_python-base.sh` + 科学/PDF 栈 + torch cu124 |
| `.gitignore` | 改：加两个 `*.local.sh` |
| `README.md` | 改：加"Docker 镜像发布"小节 |

**实现顺序**：先 SSOT 清单与映射函数（其余都依赖它）→ 私有/示范文件 → gitignore → build 脚本 → push 脚本 → Dockerfile/依赖脚本 → README。每个 Task 自成可提交单元。

**测试策略**：bash 脚本无单元测试框架，用三种手段验证——(1) `bash -n` 语法检查；(2) 为纯函数（`remote_repo`、参数解析、镜像/registry 筛选）写一次性 driver 脚本断言输出；(3) `--dry-run` 核对端到端计划。重型 docker 构建放最后单独验证（耗时，非每步必跑）。

---

## Task 1: SSOT 清单 + 命名映射函数

**Files:**
- Create: `scripts/release-images.sh`
- Test: `scripts/_test-release-images.sh`（临时 driver，验证后删除）

- [x] **Step 1: 写 SSOT 清单脚本**

Create `scripts/release-images.sh`：

```bash
#!/usr/bin/env bash
# release-images.sh — SSOT for image build + multi-registry push.
# Sourced by release-build.sh and release-push.sh. Defines:
#   RELEASE_IMAGES      本地镜像 → Dockerfile + 额外 build-arg
#   RELEASE_REGISTRIES  推送目标 → 前缀 + 命名风格
#   remote_repo()       本地镜像名 → 某 registry 的完整仓库路径
# 私有 registry 地址在 release-targets.local.sh（不提交）里 append。

# 本地镜像清单: "本地镜像名|Dockerfile 路径|额外 build-arg(空格分隔，可空)"
RELEASE_IMAGES=(
  "brainpilot-main|docker/main/Dockerfile|"
  "brainpilot-sandbox|docker/sandbox/Dockerfile|SANDBOX_EXTRA_DEPS=extra-deps.sh"
  "brainpilot-sandbox-gpu|docker/sandbox/Dockerfile|SANDBOX_EXTRA_DEPS=extra-deps.gpu.sh"
)

# registry 清单: "registry键|前缀|命名风格(flat|acr)"
# ghcr 地址本就公开，写死在提交版本里。
RELEASE_REGISTRIES=( "ghcr|ghcr.io/neuroaihub|flat" )

# 私有目标（ACR 实例 ID / 内网 IP）从不提交的本地文件 append。
_REL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$_REL_DIR/release-targets.local.sh" ] && source "$_REL_DIR/release-targets.local.sh"

# remote_repo <本地镜像名> <前缀> <风格>
#   flat → 前缀/本地名               (brainpilot-main)
#   acr  → 前缀/去 brainpilot- 前缀  (main)
remote_repo() {
  local local_name="$1" prefix="$2" style="$3"
  case "$style" in
    flat) echo "${prefix}/${local_name}" ;;
    acr)  echo "${prefix}/${local_name#brainpilot-}" ;;
    *)    echo "remote_repo: unknown style '$style'" >&2; return 1 ;;
  esac
}
```

- [x] **Step 2: 写临时 driver 测试映射函数**

Create `scripts/_test-release-images.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source release-images.sh

fail=0
check() { # check <实际> <期望> <说明>
  if [ "$1" = "$2" ]; then echo "PASS: $3"; else echo "FAIL: $3 — got '$1' want '$2'"; fail=1; fi
}

check "$(remote_repo brainpilot-main ghcr.io/neuroaihub flat)" \
      "ghcr.io/neuroaihub/brainpilot-main" "ghcr main (flat)"
check "$(remote_repo brainpilot-sandbox-gpu ghcr.io/neuroaihub flat)" \
      "ghcr.io/neuroaihub/brainpilot-sandbox-gpu" "ghcr sandbox-gpu (flat)"
check "$(remote_repo brainpilot-main some/brainpilot acr)" \
      "some/brainpilot/main" "acr main (短名)"
check "$(remote_repo brainpilot-sandbox-gpu some/brainpilot acr)" \
      "some/brainpilot/sandbox-gpu" "acr sandbox-gpu (短名)"
check "${#RELEASE_IMAGES[@]}" "3" "镜像清单 3 条"
check "${RELEASE_REGISTRIES[0]}" "ghcr|ghcr.io/neuroaihub|flat" "ghcr 默认 registry"

exit $fail
```

- [x] **Step 3: 运行 driver，验证全 PASS**

Run: `bash scripts/_test-release-images.sh`
Expected: 6 行 PASS，退出码 0：
```
PASS: ghcr main (flat)
PASS: ghcr sandbox-gpu (flat)
PASS: acr main (短名)
PASS: acr sandbox-gpu (短名)
PASS: 镜像清单 3 条
PASS: ghcr 默认 registry
```

- [x] **Step 4: 语法检查 + 删除临时 driver**

```bash
bash -n scripts/release-images.sh
rm scripts/_test-release-images.sh
```
Expected: 无输出（语法 OK），driver 已删。

- [x] **Step 5: Commit**

```bash
git add scripts/release-images.sh
git commit -m "feat(release): add SSOT image/registry manifest + remote_repo mapping"
```

---

## Task 2: 私有目标 / 示范文件 + gitignore

**Files:**
- Create: `scripts/release-targets.example.sh`
- Create: `scripts/release-targets.local.sh`（不提交）
- Create: `scripts/release-mirrors.example.sh`
- Create: `scripts/release-mirrors.local.sh`（不提交）
- Modify: `.gitignore`

- [x] **Step 1: 写 targets 示范文件（提交版）**

Create `scripts/release-targets.example.sh`：

```bash
# 复制为 release-targets.local.sh 并填入真实地址。local 文件已被 .gitignore 排除。
# 向 RELEASE_REGISTRIES append 私有推送目标。格式: "键|前缀|风格(flat|acr)"
RELEASE_REGISTRIES+=( "acr|<实例ID>.cn-<region>.personal.cr.aliyuncs.com/<命名空间>|acr" )
RELEASE_REGISTRIES+=( "intranet|<内网IP>:<端口>|flat" )
```

- [x] **Step 2: 写 targets 本地文件（真实地址，不提交）**

Create `scripts/release-targets.local.sh`：

```bash
# 私有推送目标 —— 不提交。
RELEASE_REGISTRIES+=( "acr|crpi-t2q2y3ujes80doq8.cn-beijing.personal.cr.aliyuncs.com/brainpilot|acr" )
RELEASE_REGISTRIES+=( "intranet|10.0.3.125:5000|flat" )
```

- [x] **Step 3: 写 mirrors 示范文件（提交版）**

Create `scripts/release-mirrors.example.sh`：

```bash
# 复制为 release-mirrors.local.sh 启用国内镜像源加速。local 文件已被 .gitignore 排除。
# 留空或不创建 local 文件 = 用官方源（pypi.org / deb.debian.org）。
export PIP_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"
export PIP_EXTRA_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple/"
export APT_MIRROR="http://mirrors.aliyun.com"
export NPM_REGISTRY="https://registry.npmmirror.com"
```

- [x] **Step 4: 写 mirrors 本地文件（真实源，不提交）**

Create `scripts/release-mirrors.local.sh`：

```bash
# 本机实际镜像源 —— 不提交。legacy 实测：Clash 代理 RST pypi.org，但阿里云正常。
export PIP_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"
export PIP_EXTRA_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple/"
export APT_MIRROR="http://mirrors.aliyun.com"
export NPM_REGISTRY="https://registry.npmmirror.com"
```

- [x] **Step 5: 更新 .gitignore**

在 `.gitignore` 的 `# Local env files` 段（`.env.*.local` 行之后）追加：

```
# Release push private config (registry addresses + mirror sources)
scripts/release-targets.local.sh
scripts/release-mirrors.local.sh
```

- [x] **Step 6: 验证 local 文件被忽略、example 文件可提交**

Run:
```bash
git check-ignore scripts/release-targets.local.sh scripts/release-mirrors.local.sh
git status --short scripts/
```
Expected: 第一条命令输出两个 `.local.sh` 路径（确认被忽略）；`git status` 只见 `release-targets.example.sh`、`release-mirrors.example.sh`、`.gitignore` 为待提交（两个 `.local.sh` **不出现**）。

- [x] **Step 7: 验证清单能正确加载私有目标**

Run:
```bash
bash -c 'cd scripts && source release-images.sh && printf "%s\n" "${RELEASE_REGISTRIES[@]}"'
```
Expected: 3 行——ghcr、acr（含 crpi-… 真实地址）、intranet（10.0.3.125:5000）。证明 `release-images.sh` 经 local 文件 append 后有全部 3 个 registry。

- [x] **Step 8: Commit（只提交 example + gitignore）**

```bash
git add scripts/release-targets.example.sh scripts/release-mirrors.example.sh .gitignore
git commit -m "feat(release): externalize private registry targets + mirror sources"
```

---

## Task 3: 改造 build 脚本（循环读清单 + 子集 + 镜像源注入）

**Files:**
- Modify: `scripts/release-build.sh`（全量重写）

- [x] **Step 1: 全量重写 build 脚本**

Replace `scripts/release-build.sh` 全部内容为：

```bash
#!/usr/bin/env bash
# Release image build — 读 release-images.sh 清单循环构建，打 latest + 版本号两 tag。
# 用法:
#   bash scripts/release-build.sh                 # 构建全部镜像
#   bash scripts/release-build.sh sandbox         # 只构建名字含 "sandbox" 的镜像（子集）
#   bash scripts/release-build.sh main sandbox-gpu# 多个子集
# 镜像源/代理来自 release-mirrors.local.sh（不提交），无则用官方源默认。
set -euo pipefail
cd "$(dirname "$0")/.."

source scripts/release-images.sh
# 镜像源外置：本地文件存在则覆盖官方源默认值（设 PIP_INDEX_URL/APT_MIRROR/NPM_REGISTRY 等）
[ -f scripts/release-mirrors.local.sh ] && source scripts/release-mirrors.local.sh

VERSION="$(node -p "require('./package.json').version")"
PROXY="${BUILD_PROXY:-http://127.0.0.1:7890}"

# 子集匹配：无参数=全建；有参数=镜像名包含任一参数子串才建
_matches() { # _matches <镜像名> <参数...>
  local name="$1"; shift
  local pat
  for pat in "$@"; do [[ "$name" == *"$pat"* ]] && return 0; done
  return 1
}

# 经典构建器：BuildKit 镜像解析器不吃 dockerd 的 systemd 代理、直连被墙的 Docker Hub；
# 经典构建器走守护进程代理路径（已验证 docker pull 可用）。这些 Dockerfile 无 BuildKit 专属语法。
# 注：DOCKER_BUILDKIT=0 必须内联给 sudo —— sudo 会清环境变量，export 不生效。
COMMON=(
  --network=host
  --build-arg "HTTP_PROXY=${PROXY}"
  --build-arg "HTTPS_PROXY=${PROXY}"
  --build-arg "NPM_REGISTRY=${NPM_REGISTRY:-}"
  --build-arg "APT_MIRROR=${APT_MIRROR:-}"
  --build-arg "PIP_INDEX_URL=${PIP_INDEX_URL:-}"
  --build-arg "PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL:-}"
)

echo "==> version=${VERSION} proxy=${PROXY} (mirrors: pip=${PIP_INDEX_URL:-官方} apt=${APT_MIRROR:-官方})"

built=()
for entry in "${RELEASE_IMAGES[@]}"; do
  IFS='|' read -r name dockerfile extra_arg <<< "$entry"
  if [ $# -gt 0 ] && ! _matches "$name" "$@"; then
    echo "==> skip $name (不匹配子集)"
    continue
  fi
  extra=(); [ -n "$extra_arg" ] && extra=( --build-arg "$extra_arg" )
  echo "==> building $name (tags: latest, $VERSION)"
  sudo DOCKER_BUILDKIT=0 docker build "${COMMON[@]}" "${extra[@]}" \
    -f "$dockerfile" -t "$name:latest" -t "$name:$VERSION" .
  built+=("$name")
done

echo "==> BUILD DONE: ${built[*]:-(无匹配镜像)}"
sudo docker images | grep -E 'brainpilot-(main|sandbox)' || true
```

- [x] **Step 2: 语法检查**

Run: `bash -n scripts/release-build.sh`
Expected: 无输出（语法 OK）。

- [x] **Step 3: 验证子集匹配逻辑（不实际构建）**

把 docker build 行临时替换为 echo 来验证筛选——运行内联测试：
```bash
bash -c '
  _matches() { local name="$1"; shift; local pat; for pat in "$@"; do [[ "$name" == *"$pat"* ]] && return 0; done; return 1; }
  _matches brainpilot-sandbox-gpu sandbox && echo "PASS: sandbox 匹配 gpu 变体"
  _matches brainpilot-main sandbox || echo "PASS: main 不匹配 sandbox"
  _matches brainpilot-sandbox-gpu gpu && echo "PASS: gpu 精确匹配"
'
```
Expected:
```
PASS: sandbox 匹配 gpu 变体
PASS: main 不匹配 sandbox
PASS: gpu 精确匹配
```

- [x] **Step 4: Commit**

```bash
git add scripts/release-build.sh
git commit -m "refactor(release): build script reads manifest, supports subset + mirror injection"
```

---

## Task 4: push 脚本（参数解析 + tag/push + dry-run + 失败汇总）

**Files:**
- Create: `scripts/release-push.sh`
- Test: `scripts/_test-release-push.sh`（临时 driver）

- [x] **Step 1: 写 push 脚本**

Create `scripts/release-push.sh`：

```bash
#!/usr/bin/env bash
# Release image push — 把本地已构建镜像 tag+push 到选定 registry。不重新构建。
# 用法:
#   bash scripts/release-push.sh                                 # 全部镜像 → 全部已配置 registry
#   bash scripts/release-push.sh --registry acr,intranet         # 只推这些 registry（跳过 ghcr）
#   bash scripts/release-push.sh --image sandbox-gpu             # 只推名字含该子串的镜像
#   bash scripts/release-push.sh --image sandbox-gpu --registry acr,intranet
#   bash scripts/release-push.sh --dry-run                       # 只打印 tag/push 计划，不真推
set -uo pipefail   # 注意：不用 -e，单个 registry 失败要继续推其他并汇总
cd "$(dirname "$0")/.."

source scripts/release-images.sh
VERSION="$(node -p "require('./package.json').version")"

IMAGE_FILTER=""; REGISTRY_FILTER=""; DRY_RUN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --image)    IMAGE_FILTER="$2"; shift 2 ;;
    --registry) REGISTRY_FILTER="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# 逗号分隔列表是否包含某键（精确匹配段）
_in_csv() { # _in_csv <键> <csv>
  local key="$1" csv="$2" IFS=','
  for k in $csv; do [ "$k" = "$key" ] && return 0; done
  return 1
}

declare -a OK_LIST FAIL_LIST
for img_entry in "${RELEASE_IMAGES[@]}"; do
  IFS='|' read -r img _df _arg <<< "$img_entry"
  # 镜像子集：--image 是子串匹配（与 build 一致）
  if [ -n "$IMAGE_FILTER" ] && [[ "$img" != *"$IMAGE_FILTER"* ]]; then continue; fi

  if ! sudo docker image inspect "$img:$VERSION" >/dev/null 2>&1; then
    echo "缺本地镜像 $img:$VERSION —— 先跑 scripts/release-build.sh"; exit 1
  fi

  for reg_entry in "${RELEASE_REGISTRIES[@]}"; do
    IFS='|' read -r key prefix style <<< "$reg_entry"
    # registry 子集：--registry 是精确键匹配（逗号分隔）
    if [ -n "$REGISTRY_FILTER" ] && ! _in_csv "$key" "$REGISTRY_FILTER"; then continue; fi
    repo="$(remote_repo "$img" "$prefix" "$style")"
    for tag in "$VERSION" latest; do
      echo "==> $img:$tag → $repo:$tag"
      [ -n "$DRY_RUN" ] && { OK_LIST+=("(dry) $repo:$tag"); continue; }
      if sudo docker tag "$img:$tag" "$repo:$tag" && sudo docker push "$repo:$tag"; then
        OK_LIST+=("$repo:$tag")
      else
        FAIL_LIST+=("$repo:$tag")
      fi
    done
  done
done

echo ""; echo "==== 推送汇总 ===="
echo "成功 ${#OK_LIST[@]}:"; printf '  ✓ %s\n' "${OK_LIST[@]:-（无）}"
if [ "${#FAIL_LIST[@]}" -gt 0 ]; then
  echo "失败 ${#FAIL_LIST[@]}:"; printf '  ✗ %s\n' "${FAIL_LIST[@]}"
  exit 1
fi
```

- [x] **Step 2: 写临时 driver 测试参数解析 + 筛选（mock docker）**

Create `scripts/_test-release-push.sh`：

```bash
#!/usr/bin/env bash
# 用 PATH 注入假 docker，--dry-run 跑通筛选逻辑，断言输出行。
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

# 假 docker：image inspect 永远成功（假装本地有镜像），其他命令 no-op
TMPBIN="$(mktemp -d)"
cat > "$TMPBIN/docker" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  image) exit 0 ;;   # inspect 成功
  *) exit 0 ;;
esac
EOF
chmod +x "$TMPBIN/docker"
# 假 sudo：直接执行后续命令（去掉 sudo 前缀）
cat > "$TMPBIN/sudo" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF
chmod +x "$TMPBIN/sudo"
export PATH="$TMPBIN:$PATH"

check_contains() { # check_contains <输出> <期望子串> <说明>
  if grep -qF "$2" <<<"$1"; then echo "PASS: $3"; else echo "FAIL: $3 — 缺 '$2'"; fail=1; fi
}
check_absent() { # check_absent <输出> <不应出现子串> <说明>
  if grep -qF "$2" <<<"$1"; then echo "FAIL: $3 — 不应含 '$2'"; fail=1; else echo "PASS: $3"; fi
}

# 1) --dry-run --registry ghcr --image main：只应出现 ghcr/main
out="$(bash scripts/release-push.sh --dry-run --registry ghcr --image main)"
check_contains "$out" "ghcr.io/neuroaihub/brainpilot-main" "ghcr main 出现"
check_absent  "$out" "sandbox" "main 过滤掉 sandbox"
check_absent  "$out" "crpi-"   "registry=ghcr 时不含 ACR"

# 2) --dry-run --registry acr --image sandbox-gpu：ACR 短名 sandbox-gpu
out="$(bash scripts/release-push.sh --dry-run --registry acr --image sandbox-gpu)"
check_contains "$out" "/brainpilot/sandbox-gpu" "ACR 短名 sandbox-gpu"
check_absent  "$out" "brainpilot-main" "image=sandbox-gpu 过滤掉 main"

# 3) 未知参数退出码 2
bash scripts/release-push.sh --bogus >/dev/null 2>&1; [ $? -eq 2 ] && echo "PASS: 未知参数退出 2" || { echo "FAIL: 未知参数退出码"; fail=1; }

rm -rf "$TMPBIN"
exit $fail
```

- [x] **Step 3: 运行 driver，验证全 PASS**

Run: `bash scripts/_test-release-push.sh`
Expected: 全 PASS、退出码 0：
```
PASS: ghcr main 出现
PASS: main 过滤掉 sandbox
PASS: registry=ghcr 时不含 ACR
PASS: ACR 短名 sandbox-gpu
PASS: image=sandbox-gpu 过滤掉 main
PASS: 未知参数退出 2
```
（前提：Task 2 的 `release-targets.local.sh` 已存在，ACR 条目才会被加载。）

- [x] **Step 4: 语法检查 + 删除临时 driver**

```bash
bash -n scripts/release-push.sh
rm scripts/_test-release-push.sh
```
Expected: 无输出，driver 已删。

- [x] **Step 5: Commit**

```bash
git add scripts/release-push.sh
git commit -m "feat(release): add multi-registry push script (subset/dry-run/failure summary)"
```

---

## Task 5: 共享 python 安装段 `_python-base.sh`

**Files:**
- Create: `docker/sandbox/_python-base.sh`

- [x] **Step 1: 写共享脚本**

Create `docker/sandbox/_python-base.sh`：

```bash
#!/usr/bin/env bash
# _python-base.sh — cpu/gpu sandbox 共享的 python3 + pip + 镜像源安装段。
# 由 extra-deps.sh / extra-deps.gpu.sh source。镜像源来自 ENV（Dockerfile 经 build-arg 透传），
# 为空则用镜像自带官方源（pypi.org / deb.debian.org）。
set -euo pipefail

# apt 源：APT_MIRROR 注入则替换官方源
[ -n "${APT_MIRROR:-}" ] && sed -i "s|http://deb.debian.org|$APT_MIRROR|g" \
  /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null || true
apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv
rm -rf /var/lib/apt/lists/*

# pip 源：PIP_INDEX_URL 注入则固化 /etc/pip.conf，否则用 pip 官方默认
if [ -n "${PIP_INDEX_URL:-}" ]; then
  { echo '[global]'
    echo "index-url = ${PIP_INDEX_URL}"
    [ -n "${PIP_EXTRA_INDEX_URL:-}" ] && echo "extra-index-url = ${PIP_EXTRA_INDEX_URL}"
    echo 'timeout = 60'
  } > /etc/pip.conf
fi
```

- [x] **Step 2: 语法检查**

Run: `bash -n docker/sandbox/_python-base.sh`
Expected: 无输出。

- [x] **Step 3: Commit**

```bash
git add docker/sandbox/_python-base.sh
git commit -m "feat(sandbox): shared python3+pip+mirror install fragment"
```

---

## Task 6: cpu 依赖脚本改为装 Python

**Files:**
- Modify: `docker/sandbox/extra-deps.sh`（全量重写）

- [x] **Step 1: 全量重写 cpu extra-deps**

Replace `docker/sandbox/extra-deps.sh` 全部内容为：

```bash
#!/usr/bin/env bash
# extra-deps.sh — cpu sandbox 基线依赖（构建期执行，由 Dockerfile RUN 调用）。
# 装 python3 + pip + venv，让 agent 能通过 Pi SDK 的 bash 工具运行 Python 代码
# （persona 指示 agent "write/edit 文件 + bash 运行"）。
# 不预装科学库 —— agent 按需自装（persona 本就要求 agent 管理依赖），保持镜像轻量。
# GPU 变体见 extra-deps.gpu.sh。镜像源经 ENV 注入（见 _python-base.sh）。
set -euo pipefail

source "$(dirname "$0")/_python-base.sh"

echo "[extra-deps] cpu baseline: python3 $(python3 --version 2>&1) installed (no sci libs)"
```

注：Dockerfile 把脚本及其同目录文件 COPY 到 `/tmp/`，故 `$(dirname "$0")/_python-base.sh` 解析为 `/tmp/_python-base.sh`（Task 8 的 Dockerfile 会一并 COPY）。

- [x] **Step 2: 语法检查**

Run: `bash -n docker/sandbox/extra-deps.sh`
Expected: 无输出。

- [x] **Step 3: Commit**

```bash
git add docker/sandbox/extra-deps.sh
git commit -m "feat(sandbox): cpu baseline installs python3 (fixes agent python exec gap)"
```

---

## Task 7: gpu 依赖脚本（科学/PDF 栈 + torch cu124）

**Files:**
- Create: `docker/sandbox/extra-deps.gpu.sh`

- [x] **Step 1: 写 gpu extra-deps**

Create `docker/sandbox/extra-deps.gpu.sh`：

```bash
#!/usr/bin/env bash
# extra-deps.gpu.sh — sandbox-gpu 变体依赖（构建期执行）。
# = cpu 的 python3 基础 + 预装科学/PDF 栈 + CUDA 12.4 PyTorch。
# torch 版本/源沿用 legacy 实测配置（legacy/docker/agent_runtime/Dockerfile.base，2026-05-29）。
# 镜像源经 ENV 注入（见 _python-base.sh）；torch 用专属 whl 源不受其影响。
set -euo pipefail

# 1) python3 + pip + 镜像源（与 cpu 共享）
source "$(dirname "$0")/_python-base.sh"

# 2) 科学/PDF 栈（最新稳定，走上面配置的 pip 源）
pip3 install --break-system-packages \
  numpy pandas scipy matplotlib scikit-learn pillow pypdf pdfplumber

# 3) CUDA 12.4 runtime wheels（pip 默认源，国内由 PIP_INDEX_URL 指向阿里云/清华）
pip3 install --break-system-packages \
  nvidia-cuda-runtime-cu12==12.4.127 nvidia-cuda-nvrtc-cu12==12.4.127 \
  nvidia-cudnn-cu12==9.1.0.70 nvidia-cublas-cu12==12.4.5.8 \
  nvidia-cufft-cu12==11.2.1.3 nvidia-curand-cu12==10.3.5.147 \
  nvidia-cusolver-cu12==11.6.1.9 nvidia-cusparse-cu12==12.3.1.170 \
  nvidia-nccl-cu12==2.21.5 nvidia-nvtx-cu12==12.4.127 nvidia-nvjitlink-cu12==12.4.127

# 4) PyTorch cu124（官方 whl 源——清华 pytorch-wheels 不同步 cu124 会 404；
#    此 index-url 是 torch 专属、不受镜像源外置影响。构建时 --network=host 借宿主代理）
pip3 install --break-system-packages \
  torch==2.5.1+cu124 torchvision==0.20.1+cu124 torchaudio==2.5.1+cu124 \
  --index-url https://download.pytorch.org/whl/cu124 \
  --extra-index-url "${PIP_INDEX_URL:-https://pypi.org/simple/}"

echo "[extra-deps.gpu] sci stack + torch 2.5.1+cu124 installed"
```

- [x] **Step 2: 语法检查**

Run: `bash -n docker/sandbox/extra-deps.gpu.sh`
Expected: 无输出。

- [x] **Step 3: Commit**

```bash
git add docker/sandbox/extra-deps.gpu.sh
git commit -m "feat(sandbox): gpu variant deps — sci/pdf stack + torch 2.5.1+cu124"
```

---

## Task 8: Dockerfile 支持变体 + 镜像源透传

**Files:**
- Modify: `docker/sandbox/Dockerfile`（runtime 阶段 extra-deps 段，当前 28-46 行附近）

- [x] **Step 1: 读现有 Dockerfile runtime 阶段确认上下文**

Run: `sed -n '26,49p' docker/sandbox/Dockerfile`
Expected: 看到 `ARG APT_MIRROR=""`、`ARG NPM_REGISTRY=""`、`COPY docker/sandbox/extra-deps.sh /tmp/extra-deps.sh`、`RUN chmod +x ... bash /tmp/extra-deps.sh`、`ENV PORT=8081 ...`。

- [x] **Step 2: 改 runtime 阶段的 ARG 段**

把现有的（runtime 阶段，约 28-29 行）：

```dockerfile
ARG APT_MIRROR=""
ARG NPM_REGISTRY=""
```

替换为：

```dockerfile
ARG APT_MIRROR=""
ARG NPM_REGISTRY=""
# sandbox 变体选择 + pip 镜像源（build-arg → ENV，供 extra-deps 脚本读取；空则官方源默认）
ARG SANDBOX_EXTRA_DEPS=extra-deps.sh
ARG PIP_INDEX_URL=""
ARG PIP_EXTRA_INDEX_URL=""
ENV APT_MIRROR=${APT_MIRROR} PIP_INDEX_URL=${PIP_INDEX_URL} PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL}
```

- [x] **Step 3: 改 COPY + RUN 段（按变体选脚本，并带上共享片段）**

把现有的（约 45-46 行）：

```dockerfile
COPY docker/sandbox/extra-deps.sh /tmp/extra-deps.sh
RUN chmod +x /tmp/extra-deps.sh && bash /tmp/extra-deps.sh
```

替换为：

```dockerfile
# 同时 COPY 共享片段 + 选中的变体脚本（cpu: extra-deps.sh / gpu: extra-deps.gpu.sh）。
# 两个脚本都 source ./_python-base.sh，故 _python-base.sh 必须同目录存在。
COPY docker/sandbox/_python-base.sh /tmp/_python-base.sh
COPY docker/sandbox/${SANDBOX_EXTRA_DEPS} /tmp/extra-deps.sh
RUN chmod +x /tmp/extra-deps.sh /tmp/_python-base.sh && bash /tmp/extra-deps.sh
```

- [x] **Step 4: 验证 Dockerfile 引用一致性**

Run:
```bash
grep -n "SANDBOX_EXTRA_DEPS\|_python-base\|extra-deps\|PIP_INDEX_URL" docker/sandbox/Dockerfile
```
Expected: 看到 `ARG SANDBOX_EXTRA_DEPS=extra-deps.sh`、`ENV ... PIP_INDEX_URL`、`COPY docker/sandbox/_python-base.sh`、`COPY docker/sandbox/${SANDBOX_EXTRA_DEPS}`、`RUN ... bash /tmp/extra-deps.sh` 各就各位，变量名与 build/push 脚本一致。

- [x] **Step 5: Commit**

```bash
git add docker/sandbox/Dockerfile
git commit -m "feat(sandbox): Dockerfile selects cpu/gpu extra-deps + passes pip mirror env"
```

---

## Task 9: cpu sandbox 真实构建验证

**Files:** 无（验证 Task 5/6/8 的集成）

> 重型步骤，需 Docker daemon（`sudo`）。构建走 `release-mirrors.local.sh` 的阿里云源 + 宿主代理。

- [x] **Step 1: 精确构建 cpu sandbox 单镜像**

> 注：`release-build.sh sandbox` 的子串匹配会同时命中 `brainpilot-sandbox` 和
> `brainpilot-sandbox-gpu`（gpu 名也含 "sandbox"）。本步要隔离验证 cpu，故直接用精确
> docker 命令构建单镜像，不走子集脚本。

Run:
```bash
source scripts/release-mirrors.local.sh
sudo DOCKER_BUILDKIT=0 docker build --network=host \
  --build-arg HTTP_PROXY=http://127.0.0.1:7890 --build-arg HTTPS_PROXY=http://127.0.0.1:7890 \
  --build-arg NPM_REGISTRY="$NPM_REGISTRY" --build-arg APT_MIRROR="$APT_MIRROR" \
  --build-arg PIP_INDEX_URL="$PIP_INDEX_URL" --build-arg PIP_EXTRA_INDEX_URL="$PIP_EXTRA_INDEX_URL" \
  --build-arg SANDBOX_EXTRA_DEPS=extra-deps.sh \
  -f docker/sandbox/Dockerfile -t brainpilot-sandbox:test .
```
Expected: 构建成功，末尾 `Successfully tagged brainpilot-sandbox:test`。日志中可见 `[extra-deps] cpu baseline: python3 Python 3.x ... installed`。

- [x] **Step 2: 验证镜像内有 python3 且 runtime 可启动**

Run:
```bash
sudo docker run --rm brainpilot-sandbox:test python3 --version
sudo docker run --rm brainpilot-sandbox:test node -e "console.log('node ok')"
```
Expected: 打印 `Python 3.x.y` 和 `node ok`（证明 cpu sandbox 同时具备 Python 与 Node，修复了缺口）。

- [x] **Step 3: 验证现有 compose 默认路径不回归（静态等价验证）**

> compose build 默认走 BuildKit（会重现 Docker Hub 拉取被墙问题）且 compose.yml 未传
> `SANDBOX_EXTRA_DEPS`，在本环境真跑不可靠。改为验证"默认路径等价"：Dockerfile 默认
> `ARG SANDBOX_EXTRA_DEPS=extra-deps.sh`，而 Step 1 已用该默认值构建成功——证明任何不传
> 该 build-arg 的调用方（含 compose）都会走 cpu 基线，行为只是"多装了 python3"，不破坏启动。

Run:
```bash
grep -q 'ARG SANDBOX_EXTRA_DEPS=extra-deps.sh' docker/sandbox/Dockerfile && echo "PASS: 默认变体=cpu extra-deps.sh"
grep -q 'SANDBOX_EXTRA_DEPS' docker-compose.yml && echo "WARN: compose 显式传了变体（需复核）" || echo "PASS: compose 未覆盖变体，走 Dockerfile 默认"
```
Expected:
```
PASS: 默认变体=cpu extra-deps.sh
PASS: compose 未覆盖变体，走 Dockerfile 默认
```

- [x] **Step 4: 清理测试镜像（无需 commit，本 Task 仅验证）**

Run: `sudo docker rmi brainpilot-sandbox:test || true`

---

## Task 10: README 文档 + dry-run 端到端核对

**Files:**
- Modify: `README.md`（在 "📦 Publishing (maintainers)" 小节后新增 "Docker 镜像发布"）

- [x] **Step 1: dry-run 核对 registry 全路径**

> push 脚本在 `--dry-run` 下**仍会**对每个镜像做 `docker image inspect`（缺镜像检查不跳过）。
> 为避免依赖"全部三镜像已构建"，用 `--image main` 缩小到上轮已存在的 main 镜像。

Run: `bash scripts/release-push.sh --dry-run --image main`
Expected: 仅 main 的 3 registry × 2 tag = 6 行计划，路径与 §1.1 矩阵一致：
```
==> brainpilot-main:0.0.3 → ghcr.io/neuroaihub/brainpilot-main:0.0.3
==> brainpilot-main:latest → ghcr.io/neuroaihub/brainpilot-main:latest
==> brainpilot-main:0.0.3 → crpi-t2q2y3ujes80doq8.cn-beijing.personal.cr.aliyuncs.com/brainpilot/main:0.0.3
==> brainpilot-main:latest → crpi-…/brainpilot/main:latest
==> brainpilot-main:0.0.3 → 10.0.3.125:5000/brainpilot-main:0.0.3
==> brainpilot-main:latest → 10.0.3.125:5000/brainpilot-main:latest
```
末尾"推送汇总"列出 6 条 `(dry)` 成功项、0 失败。

- [x] **Step 2: 在 README 增加 Docker 发布小节**

在 `README.md` 的 `## 📦 Publishing (maintainers)` 小节（`@brainpilot/client-cli stays private...` 行）之后，`## 🧪 Testing` 之前，插入：

````markdown
### Docker 镜像发布

镜像版本号与 npm 版本一致（根 `package.json` 的 `version`）。三个镜像：`brainpilot-main`、
`brainpilot-sandbox`（cpu）、`brainpilot-sandbox-gpu`（CUDA torch）。

```bash
# 一次性：复制示范配置，填入国内镜像源 / 私有 registry 地址（两个 .local 文件均不提交）
cp scripts/release-mirrors.example.sh scripts/release-mirrors.local.sh   # pip/apt 镜像源
cp scripts/release-targets.example.sh scripts/release-targets.local.sh   # ACR/内网 registry

# 构建（默认全部；可传子串只建子集）
bash scripts/release-build.sh                # 全部三个镜像
bash scripts/release-build.sh main           # 只建 main
bash scripts/release-build.sh sandbox-gpu    # 只建 GPU 变体（体积大、慢）

# 推送（需先 docker login 各 registry）
bash scripts/release-push.sh --dry-run                       # 先看计划
bash scripts/release-push.sh                                 # 全部 → 全部 registry
bash scripts/release-push.sh --image sandbox-gpu --registry acr,intranet  # GPU 跳过公网 ghcr
```

推送目标 registry 在 `scripts/release-images.sh`（ghcr，公开）+ `release-targets.local.sh`
（ACR / 内网，私有）声明。GPU 镜像约 6GB，推公网 ghcr 可能超时，建议 `--registry acr,intranet`。
````

- [x] **Step 2.5: 校验 README 插入处格式**

Run: `grep -n "Docker 镜像发布\|release-build.sh\|release-push.sh\|## 🧪 Testing" README.md`
Expected: "Docker 镜像发布" 行号在 "## 🧪 Testing" 行号之前；build/push 命令均出现。

- [x] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): add Docker image build + multi-registry push section"
```

---

## Task 11: GPU 镜像构建验证（可选 / 重型，需 GPU 主机网络）

**Files:** 无（验证 Task 7 集成）

> ⚠️ 体积大（~6GB）、构建慢（torch 下载）。torch whl 走 `download.pytorch.org` 官方源——
> 依赖 `--network=host` 借宿主 Clash 代理。若代理对该域不通，此步会失败（与设计已知风险一致）。
> 非阻塞主线交付；可在有条件时单独执行。

- [x] **Step 1: 单独构建 gpu 变体**

```bash
source scripts/release-mirrors.local.sh
sudo DOCKER_BUILDKIT=0 docker build --network=host \
  --build-arg HTTP_PROXY=http://127.0.0.1:7890 --build-arg HTTPS_PROXY=http://127.0.0.1:7890 \
  --build-arg NPM_REGISTRY="$NPM_REGISTRY" --build-arg APT_MIRROR="$APT_MIRROR" \
  --build-arg PIP_INDEX_URL="$PIP_INDEX_URL" --build-arg PIP_EXTRA_INDEX_URL="$PIP_EXTRA_INDEX_URL" \
  --build-arg SANDBOX_EXTRA_DEPS=extra-deps.gpu.sh \
  -f docker/sandbox/Dockerfile -t brainpilot-sandbox-gpu:test .
```
Expected: 构建成功，日志末尾 `[extra-deps.gpu] sci stack + torch 2.5.1+cu124 installed`。

- [x] **Step 2: 验证 torch + 科学库可导入**

Run:
```bash
sudo docker run --rm brainpilot-sandbox-gpu:test python3 -c \
  "import torch, numpy, pandas, scipy, sklearn, matplotlib, pypdf, pdfplumber, PIL; print('torch', torch.__version__)"
```
Expected: 打印 `torch 2.5.1+cu124`，无 ImportError。

- [x] **Step 3: 清理测试镜像**

Run: `sudo docker rmi brainpilot-sandbox-gpu:test || true`

---

## 完成标准

- Task 1-8、10 完成并提交：脚本机制 + Dockerfile + 依赖脚本 + README 全部就位。
- Task 9 通过：cpu sandbox 含 python3 + node，现有 compose 不回归。
- Task 11（可选）：GPU 镜像可构建、torch 可导入。
- `git status` 干净；两个 `.local.sh` 始终未被跟踪（`git check-ignore` 确认）。
- 全流程可复现：`build → push --dry-run → push` 三步对三个 registry 产出 §1.1 矩阵中的全部路径。

---

## 执行结果（2026-06-15）

- **Task 1-8 + 10**：✅ 完成并各自提交（commit `cb12548`→`a44392d`，8 个 commit + README）。
- **Task 9（cpu sandbox 真实构建）**：✅ 通过。`brainpilot-sandbox:test` 构建成功（`DOCKER_BUILDKIT=0`
  经典构建器 + 阿里云 apt/pip 源），镜像内 `python3 --version`=Python 3.11.2、`node` 正常；
  Dockerfile 默认变体=cpu、compose 未覆盖 → 无回归。测试镜像已清理。
- **push 脚本修正**：`OK_LIST/FAIL_LIST` 改为显式 `=()` 空数组初始化，否则全成功路径在 `set -u`
  下因空 `FAIL_LIST` 触发 `unbound variable`（已验证 + 修复，含在 `c30cbe4`）。
- **Task 11（GPU 镜像）**：✅ 已构建并验证。`brainpilot-sandbox-gpu:0.0.4`（14.5GB 解压）构建成功，
  `torch 2.5.1+cu124`（cuda build 12.4）+ numpy/pandas/scipy/sklearn/matplotlib/pypdf/pdfplumber/PIL
  全部可导入。**torch 下载坑（重要）**：官方 download.pytorch.org 把 torch wheel 302 到 Cloudflare R2，
  该流经 Clash 代理限速崩溃+哈希不匹配（连续两次构建在 908MB torch 处失败）。pip `--index-url` 指交大
  也无效（交大 simple 索引登记的也是 R2 URL）。**解法**：直接拼交大 wheel 文件 URL（`/cu124/<wheel>`）
  会 302 到交大自有 S3（s3.jcloud.sjtu.edu.cn，国内 ~13MB/s），故 `extra-deps.gpu.sh` 改为 curl 直下
  三个 wheel 再 pip 装本地文件，依赖仍走阿里云 PyPI（commit `269b571`）。

### 实际发布状态（2026-06-16）
| 镜像 | ghcr（公网） | ACR（阿里云） | 内网 10.0.3.125 |
|------|:---:|:---:|:---:|
| main | ❌ denied（PAT 缺 write:packages 或 org 无包写权限） | ✅ 0.0.4+latest | ✅ 0.0.4+latest |
| sandbox (cpu) | 未推 | ✅ 0.0.4+latest | ✅ 0.0.4+latest |
| sandbox-gpu | 不推（按定） | 🔄 推送中（仅 ACR，14.5GB） | 不推 |

- **ghcr 待修**：需带 `write:packages` 的 PAT 重新 `docker login ghcr.io -u GTC2333`，或 org owner 给包写权限。
