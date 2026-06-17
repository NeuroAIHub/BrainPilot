# GPU 沙盒镜像瘦身调研

> 日期：2026-06-16 · 状态：**第一阶段已落地（实测 14.5GB→9.25GB，省 36%）；第二阶段实证后放弃**
> 镜像：`brainpilot-sandbox-gpu`（当前 0.0.4，**14.5GB** uncompressed / 5.6GB compressed）
> 工作负载（用户确认）：常规 torch 张量/推理/训练 + 科学计算（scipy/pandas/sklearn）；**不用 torch.compile**
> GPU 架构：**不确定**，用户倾向选体积小的版本

---

## 1. 14.5GB 构成实测拆解

`docker history` 显示 `extra-deps.gpu.sh` 那一个 RUN 层就占 **8.25GB**。进容器 `du` 拆解：

| 构成 | 大小 | 可否优化 |
|------|------|---------|
| `nvidia/` pip 包（CUDA 运行库） | **2.7GB** | ⚠️ torch small-wheel 硬依赖，整体不可删，但**版本可换**（见 §3） |
| `torch/lib/*.so`（libtorch_cuda 899MB 等） | 1.6GB | ⚠️ 升 torch 版本可小 133MB |
| `triton` | 556MB | ✅ **可删**（仅 torch.compile/自定义 kernel 用，用户不用） |
| scipy/pandas/sklearn/sympy/matplotlib… | ~400MB | ⚠️ 用户要保留科学计算 |
| **`/root/.cache/pip`（pip 下载缓存）** | **2.1GB** | ✅ **纯浪费，必删** |
| Debian + node + python 基础层 | ~0.7GB | ❌ 基础 |

### 1.1 nvidia 子包细分（2.7GB 大头在哪）

```
976M  nvidia/cudnn      ← 最大；其中单文件 libcudnn_engines_precompiled.so.9 占 543M
528M  nvidia/cublas
281M  nvidia/cufft
269M  nvidia/cusparse
241M  nvidia/nccl
194M  nvidia/cusolver
 95M  nvidia/curand
...
```

### 1.2 cudnn 内部（976M 里的可裁剪项）

```
543M  libcudnn_engines_precompiled.so.9   ← 所有 GPU 架构(sm_70~90)的预编译 kernel 合集；pip 包无法按架构裁剪
230M  libcudnn_adv.so.9                    ← RNN/LSTM 等高级算子；不用循环网络可删
103M  libcudnn_ops.so.9
 82M  libcudnn_heuristic.so.9
```

---

## 2. 关键架构事实

- **本机无 GPU**（`nvidia-smi` 空），但**已装 nvidia-container-toolkit 1.18.1** → 印证正确架构是 **driver 在宿主机、容器 `--gpus all` 借用**。镜像内**不含也不需要** CUDA driver（正确）。
- **但 CUDA 运行库（cudnn/cublas 等 2.7GB）必须在容器内**：torch 2.5.1 是 **small wheel**，其 `METADATA` 用 `Requires-Dist` 硬依赖 PyPI 的 `nvidia-*-cu12` 包，`torch/lib` 不再 bundle 这些库。宿主机只提供 driver + `libcuda.so`，**不提供 cudnn/cublas**。
- **结论：~6.3GB（torch + nvidia 运行库 + 基础层）是硬底**，无法靠"借宿主机"消除。瘦身只能在"删无用 + 换更小版本 + strip"三个方向。

---

## 3. 一手体积数据（交大镜像 + PyPI JSON API 实测，非估算）

### 3.1 torch 本体 wheel（不同 CUDA / 版本）

| 版本 | torch wheel | 备注 |
|------|------------|------|
| 2.5.1 **+cu118** | 800MB | 旧 CUDA，不支持 Hopper+ |
| 2.5.1 **+cu121** | **744MB** | 比 cu124 小 122MB，但不支持 sm_90+ |
| 2.5.1 **+cu124**（当前） | 866MB | |
| **2.6.0 +cu124** | **733MB** ⭐ | **比 2.5.1 小 133MB，nvidia 依赖钉版完全相同，仍 cu124（全架构兼容）** |

### 3.2 nvidia 包 cu124 vs cu121（实测 wheel 大小）

| 包 | cu124 版本/大小 | cu121 版本/大小 | 差 |
|----|----------------|----------------|----|
| cudnn | 9.1.0.70 / 634MB | 9.1.0.70 / 634MB | 0（同款） |
| cublas | 12.4.5.8 / 347MB | 12.1.3.1 / **392MB** | cu121 反而 **+45MB** |
| cusparse | 12.3.1.170 / 198MB | 12.1.0.106 / 187MB | -11MB |
| cusolver | 11.6.1.9 / 122MB | 11.4.5.107 / 118MB | -4MB |
| cufft | 11.2.1.3 / 202MB | 11.0.2.54 / **116MB** | -86MB |

> **反直觉结论**：降到 cu121 的 nvidia 包**净收益只有 ~50MB**（cufft 省 86 但 cublas 多 45），加上 torch 本体省 122MB ≈ **总共才省 ~170MB**，却要牺牲 sm_90+（H100/H200/Blackwell）支持。**性价比极差，不推荐为了体积降 cu121。**

---

## 4. 方案对比（按净收益排序）

| # | 措施 | 省多少 | 风险 | 依赖架构? | 推荐 |
|---|------|-------|------|----------|------|
| 1 | **清 pip 缓存**（`--no-cache-dir`） | **2.1GB** | 零 | 否 | ✅ 必做 |
| 2 | **卸载 triton**（不用 torch.compile） | 0.56GB | 零（用户不用） | 否 | ✅ 推荐 |
| 3 | **升 torch 2.5.1→2.6.0** | 0.13GB | 低（2.6 稳定版，依赖钉版不变） | 否 | ✅ 推荐 |
| 4 | strip .so 调试符号 + 删 libcudnn_adv（不用RNN） | 0.3–0.8GB | 低-中（需测） | 否 | ⚠️ 可选 |
| 5 | 降 cu124→cu121 | 仅 ~0.17GB | **高**（丢 sm_90+ 支持） | **是** | ❌ 不推荐 |
| 6 | C 方案：独立 `cuda-base` 共享层 | 单镜像不变 | 工程量大 | 否 | ⏸ 仅多 GPU 变体时划算 |

### 推荐组合（匹配"架构不确定 + 想要小版本"）

**措施 1 + 2 + 3**：清缓存 + 卸 triton + 升 torch 2.6.0
- **14.5GB → ~9.1GB**（省 ~5.4GB / 37%）
- **零架构风险**：仍是 cu124，支持所有 NVIDIA 架构（Ampere/Ada/Hopper/Blackwell 全覆盖）
- 零功能损失（triton 用户不用；2.6.0 是稳定版）

> 措施 4（strip）可作为第二阶段再叠加，把镜像推到 ~8.5GB，但需逐项测试 import + GPU kernel，留到验证有 GPU 的环境时做。

### 为什么不靠"降 CUDA 版本"省体积

用户倾向"选小版本"，但实测数据表明：**降 cu121 的体积收益（~170MB）微不足道，却牺牲新 GPU 支持**。真正的"小版本"红利在**升 torch 版本**（2.6.0 小 133MB 且全兼容）而非降 CUDA 版本。这是本次调研最反直觉、最有价值的发现。

---

## 5. 落地清单（待用户批准后执行）

1. `docker/sandbox/extra-deps.gpu.sh`：
   - 所有 `pip3 install` 加 `--no-cache-dir`（或结尾 `rm -rf /root/.cache/pip`）
   - torch wheel URL：`2.5.1+cu124` → `2.6.0+cu124`（三个 torch/vision/audio 同步升；torchvision 0.20.1→0.21.0，torchaudio 2.5.1→2.6.0）
   - 安装末尾 `pip3 uninstall -y triton`（或排除其安装）
2. 重建 + 实测：`python3 -c "import torch,scipy,pandas,sklearn"`、torch CUDA 库链接完整性
3. 重新打 tag + 推 ACR（GPU 仅推阿里云）
4. 更新 [[docker-release-push]] 记忆与本文档"实际结果"

---

## 6. 第一阶段实际结果（2026-06-16 落地，已构建验证）

| 项 | 旧 | 新 |
|----|-----|-----|
| **DISK 占用** | 14.5GB | **9.25GB**（省 5.25GB / **36%**） |
| torch | 2.5.1+cu124 | 2.6.0+cu124 |
| triton | 686MB（在） | ✅ 卸载 |
| pip 缓存 | 2.1GB | ✅ 清空 |
| 科学栈 | scipy/pandas/sklearn | ✅ 保留 |

功能验证：`import torch/torchvision/torchaudio`、`nn.Conv2d`、`scipy/pandas/sklearn` 全部 OK。

### 实施踩坑

- **triton 漏卸（首建 10.2GB）**：`pip uninstall -y triton` 在 PEP 668 externally-managed 环境下**需 `--break-system-packages`**，否则被**静默拒绝**（无报错、triton 仍在）。修正后 `Successfully uninstalled triton-3.2.0`。
- **torch 2.6.0 新增 `nvidia-cusparselt-cu12==0.6.2` 依赖**（2.5.1 时 bundle 在 `torch/lib/libcusparseLt.so`(212MB)，2.6 改独立 pip 包）。§3 手动钉版清单**必须补这个**，否则 `import torch` 缺库崩。

## 7. 第二阶段实证：strip/删库 → **放弃**（2026-06-16）

在镜像内逐项实测，原计划全部落空：

| 候选 | 大小 | 实测 | 结论 |
|------|------|------|------|
| **strip 所有 .so 调试符号** | — | `strip --strip-unneeded` 对 libtorch_cuda/libcublas/libcudnn 全部 **省 0MB** | ❌ NVIDIA/torch wheel 早已 strip，体积是真实机器码+多架构 GPU kernel(cubin/PTX) |
| 删 nccl | 241MB | `import torch` 即崩：`libnccl.so.2: cannot open` | ❌ torch._C 启动期硬加载 |
| 删 cusparselt | 203MB | `import torch` 即崩：`libcusparseLt.so.0` | ❌ 同上 |
| 删 cufft | 281MB | `import torch` 即崩：`libcufft.so.11` | ❌ 同上 |
| 删 libcudnn_adv（RNN/LSTM 算子） | 229MB | import+matmul+Conv2d **OK** | ⚠️ 唯一可删，但牺牲 RNN/LSTM GPU 支持，**本机无 GPU 无法验证生产是否触发**，为 2% 体积冒生产崩险，**不做** |

**关键认知**：torch 2.6 的 `from torch._C import *` 在**启动时硬链接** nccl/cusparselt/cufft 等几乎所有 nvidia 库——它们是"import 期必需"而非"运行期按需"。"删用不到的库"这条路基本不通。

**最终结论**：9.25GB 是安全瘦身极限。剩余是 GPU 加速硬成本（torch 1.6G + nvidia 必需运行库），不再继续。


---

## 附：数据采集命令（可复现）

```bash
# torch wheel 大小
curl -fsSLI "https://mirror.sjtu.edu.cn/pytorch-wheels/cu124/torch-2.6.0%2Bcu124-cp311-cp311-linux_x86_64.whl" | grep -i content-length

# nvidia 包大小
curl -fsSL "https://pypi.org/pypi/nvidia-cudnn-cu12/json" | python3 -c "import sys,json;d=json.load(sys.stdin);print([f['size'] for f in d['releases']['9.1.0.70'] if 'x86_64' in f['filename']])"

# 镜像内拆解
sudo docker run --rm --entrypoint bash brainpilot-sandbox-gpu:0.0.4 -c 'du -sh /usr/local/lib/python3.11/dist-packages/* | sort -rh | head'
```
