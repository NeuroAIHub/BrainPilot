# Brain Science 领域地图相关工作调研

最后核验：2026-08-07

## 结论摘要

有大量相关工作，但在本次检索覆盖的主流论文、标准和基础设施中，没有发现一个可以直接回答以下全部问题的统一体系：

1. Brain Science 的研究边界是什么；
2. 研究对象跨越哪些物种、生物尺度和疾病状态；
3. 有哪些观测模态、干预模态和实验范式；
4. 有哪些科学问题、分析任务和科研流程任务；
5. 每类任务需要什么数据、方法、工具、验证和证据；
6. 一个研究智能体系统当前覆盖了哪些组合，还缺哪些组合。

现有工作形成的是一组互补但相互重叠的“局部地图”：

- **NIFSTD / InterLex** 最接近跨脑科学领域术语底座；
- **openMINDS** 最接近跨模态研究产品、技术和分析的元数据框架；
- **Cognitive Atlas、CogPO、BrainMap、HED** 主要解决认知概念、实验范式和事件描述；
- **RDoC** 提供了“功能域 × 多尺度分析单元”的成熟矩阵范式；
- **BIDS、NWB** 解决特定模态的数据组织与交换，而不是完整领域分类；
- **OBI** 覆盖生物医学研究的计划、执行和报告过程；
- **EDAM** 虽非脑科学项目，却是“主题 × 操作 × 数据 × 格式”以及工具能力注册最接近 BrainPilot 产品目标的结构范例；
- **INCF** 负责评估和协调标准，但不是统一领域本体。

因此，BrainPilot 不适合从零创造另一套封闭术语，也不适合直接采用任意一个现有项目。更合理的方向是建立一个**可执行的联邦能力图谱**：复用现有稳定标识符和数据标准，新增 BrainPilot 特有的科学目标、分析任务、科研阶段、技能、数据集、验证要求和覆盖状态之间的关系。

## 调研范围与判定标准

本次为面向产品决策的探索性调研，不是完整的系统综述。检索与核验来源包括 OpenAlex、PubMed Central、项目官方网站、官方规范和当前开源仓库。

“类似”被拆成六个维度：

| 维度 | 关注内容 |
|---|---|
| 领域范围 | 学科、物种、生物尺度、正常与疾病研究 |
| 数据模态 | 采集技术、信号、数据类型、格式 |
| 实验任务 | 认知概念、范式、刺激、指令、反应、事件 |
| 科学与分析任务 | 描述、编码、解码、预测、因果、干预及具体分析操作 |
| 科研过程 | 设计、采集、质控、分析、验证、报告和溯源 |
| 可执行能力 | 数据集、软件、工作流、技能及输入输出约束 |

## 核心相关工作

### 1. NIFSTD：最接近全领域术语底座

[NIF Standard Ontology（NIFSTD）](https://github.com/SciCrunch/NIF-Ontology)将神经科学常用的解剖、细胞、分子、功能、疾病、调查技术、科学学科和数字资源整合为 OWL 本体，并复用其他 OBO 本体。当前仓库还引入了 CogPO 和 Cognitive Atlas 的部分内容。

- 优点：覆盖尺度广；有稳定标识符、同义词、层级和跨本体映射；适合做语义对齐。
- 局限：主要为资源标注、检索和概念互操作设计；没有形成面向科研智能体的“问题—数据—操作—工具—验证”能力链。
- BrainPilot 用法：作为术语和标识符来源，而不是直接作为产品目录结构。
- 许可：当前仓库标明 CC BY 4.0。

论文：[The NIFSTD and BIRNLex Vocabularies: Building Comprehensive Ontologies for Neuroscience](https://doi.org/10.1007/s12021-008-9032-z)。

### 2. openMINDS：最接近跨模态研究元数据框架

[openMINDS](https://github.com/openMetadataInitiative/openMINDS)由 Human Brain Project/EBRAINS 发展而来，当前模型包括 core、controlled terms、SANDS、computation、electrophysiology、neuroimaging、specimen preparation、stimulation、chemicals 和 publications。

截至 2026-08-07 对其 [controlled instances](https://github.com/openMetadataInitiative/openMINDS_instances) 主分支的快照统计包括：

- 40 个 `experimentalApproach`；
- 194 个 `technique`；
- 113 个 `analysisTechnique`；
- 19 个 `stimulationTechnique`；
- 6 个 `stimulationApproach`。

这些数字不能直接解释为“脑科学有多少种模态”：`technique` 同时包含成像、染色、测序、手术、采样和仿真等不同层级实体。它证明了现成词项很丰富，也证明了 BrainPilot 必须先定义正交维度和计数口径。

- 优点：跨物种、跨模态、机器可读；技术、分析、刺激、样本、解剖、计算和研究产品均有模型；当前仍活跃维护。
- 局限：核心目标是描述研究产品和溯源，不是定义所有科学问题、实验范式或智能体任务；部分词表颗粒度不一致。
- BrainPilot 用法：优先复用其技术、分析、刺激、物种、设备、信号和研究产品模型，并建立 crosswalk。
- 许可：MIT。

正式记录：[FAIRsharing openMINDS](https://doi.org/10.25504/FAIRsharing.6ac6aa)。

### 3. Cognitive Atlas：认知概念与任务的知识图谱

[Cognitive Atlas](https://doi.org/10.3389/fninf.2011.00017)区分心理概念、实验任务以及任务对概念的测量关系，目标是解决同一认知术语定义不一、同一任务可能测量多个构念的问题。

其[公开 OWL 仓库](https://github.com/poldrack/cogat/tree/master/ontology)中的历史快照包含 593 个认知概念和 374 个任务概念，但文件标明生成于 2012 年，不能当作当前完整任务总数。

- 优点：明确区分“心理构念”和“用于测量构念的任务”；关系设计非常适合实验范式层。
- 局限：以人类认知神经科学为主；不覆盖细胞、分子、动物回路、临床过程以及分析工具；命名任务集合天然开放，不能给出稳定的全领域任务总数。
- BrainPilot 用法：复用认知构念和命名范式的标识符，同时将“实验范式”与“科学目标”“分析任务”严格分开。

### 4. CogPO：将范式拆成刺激、指令和反应

[Cognitive Paradigm Ontology（CogPO）](https://doi.org/10.1007/s12021-011-9126-x)基于 BrainMap 的经验，将实验条件描述为刺激、指令和被试反应，重点面向 fMRI/PET 和行为实验。

- 优点：比单纯的任务名称更能描述范式变体；适合比较“名字不同但操作相似”的实验。
- 局限：范围集中在人类认知/功能成像；不是数据模态或分析任务本体。
- BrainPilot 用法：采用其 `stimulus–instruction–response` 分解方式，而不是将 Stroop、n-back 等名称当作不可分解的标签。
- 许可注意：[当前官方仓库](https://github.com/NBCLab/cogpo)标明 CC BY-NC-SA 4.0，正式复用前需评估商业分发兼容性。

### 5. BrainMap taxonomy：功能成像实验设计分类

[BrainMap experimental-design taxonomy](https://doi.org/10.1002/hbm.20141)将元数据组织为论文、实验和激活位置三个层级；实验层包含研究情境、行为域、范式类别、条件对比和成像模态，条件层进一步记录刺激、反应和指令。

- 优点：经过实际 fMRI/PET 文献编码和元分析检验；证明结构化范式元数据能支持跨研究检索。
- 局限：围绕坐标式人类功能成像和元分析构建，无法覆盖全脑科学模态。
- BrainPilot 用法：借鉴“研究情境—行为域—范式—条件—对比”的实验设计结构。

### 6. RDoC：成熟的多维研究矩阵

NIMH 的 [RDoC Matrix](https://www.nimh.nih.gov/research/research-funded-by-nimh/rdoc/constructs/rdoc-matrix)当前采用六个功能域：负性效价、正性效价、认知系统、社会过程、唤醒/调节系统、感觉运动系统；每个构念沿八类分析单元组织：基因、分子、细胞、回路、生理、行为、自我报告和范式。

- 优点：说明复杂领域不应压成单一树形目录，而应采用“领域/构念 × 分析尺度”的矩阵；跨传统诊断边界。
- 局限：服务于精神疾病研究，不是全脑科学本体；没有采集技术、分析操作、工具和科研流程层。
- BrainPilot 用法：借鉴多轴矩阵，而不直接采用其精神病理学边界。

背景论文：[Toward the future of psychiatric diagnosis: the seven pillars of RDoC](https://doi.org/10.1186/1741-7015-11-126)。

### 7. BIDS：模态与数据组织标准，而非领域本体

[Brain Imaging Data Structure（BIDS）](https://doi.org/10.1038/sdata.2016.44)最初用于 MRI，目前规范仓库的 schema 列出 11 个 modality：MRI、EEG、EMG、iEEG、MEG、behavior、PET、microscopy、motion、NIRS 和 MRS；同时区分 16 个 datatype，包括 anatomy、diffusion、functional、perfusion、phenotype 等。

- 优点：广泛采用、机器验证、与分析工具生态连接紧密；非常适合作为数据入口的标准标识。
- 局限：modality 与 datatype 本身就是两种不同切法；BIDS 不定义领域研究范围、科学目标或所有分析操作。
- BrainPilot 用法：直接复用支持的模态、数据类型、实体和元数据字段；不要把 BIDS 目录名等同于完整模态本体。

### 8. NWB：细胞级神经生理与光学数据语言

[Neurodata Without Borders（NWB）](https://doi.org/10.7554/eLife.78362)为跨物种的电生理和光学神经生理数据提供可扩展的数据与元数据语言，并连接采集、分析、可视化和 DANDI 归档生态。

- 优点：对细胞/组织神经生理的时间序列、单元、试次、行为和设备描述成熟；扩展机制清晰。
- 局限：它是数据语言，不是全领域任务分类；不应与 BIDS 竞争为单一总格式。
- BrainPilot 用法：作为神经生理模态的权威数据模型，通过统一上层 registry 与 BIDS、OME 等并列。

### 9. HED：跨模态事件语义

[Hierarchical Event Descriptors（HED）](https://doi.org/10.1016/j.neuroimage.2021.118766)为 EEG、MEG、iEEG、fMRI、眼动、动作捕捉、心电和视听记录中的事件及实验上下文提供层级、机器可操作的标注，并可嵌入 BIDS。

- 优点：适合描述自然场景和复杂任务中的事件，不受单一命名范式限制；支持验证与跨实验搜索。
- 局限：关注事件“发生了什么”，不定义研究者为何分析它、要执行什么算法。
- BrainPilot 用法：实验事件层优先兼容 HED；科学目标和分析操作另设维度。

### 10. NIDM-Terms 与 Neurobagel：跨数据集语义检索

[NIDM-Terms](https://doi.org/10.3389/fninf.2023.1174156)为 BIDS 数据集中的临床/行为变量增加术语标注，从而支持跨队列查询。[Neurobagel](https://github.com/neurobagel)则把表型与 BIDS 影像元数据转为 JSON-LD 知识图谱，当前主要支持年龄、性别、诊断、量表可用性和 MRI 序列发现。

- 优点：直接展示了 controlled terms、知识图谱和数据集发现的产品价值。
- 局限：当前集中于人类神经影像队列发现，不覆盖全模态和研究操作。
- BrainPilot 用法：借鉴其“局部字段映射到标准概念、原始名称仍保留”的渐进式语义标注方法。

### 11. OBI：研究生命周期的通用本体

[Ontology for Biomedical Investigations（OBI）](https://doi.org/10.1371/journal.pone.0154556)描述生物医学研究的计划、执行和报告，以及参与其中的材料、信息、角色和功能。

- 优点：覆盖调查过程而非单一模态；适合表示设计、方案、样本、设备、测量和产物之间的关系。
- 局限：通用且形式化程度高；没有 BrainPilot 所需的脑科学用户任务和工具能力粒度。
- BrainPilot 用法：复用 investigation、planned process、assay、protocol、input/output 等上层关系，避免自造科研流程语义。

### 12. EDAM：最值得借鉴的产品结构

[EDAM](https://doi.org/10.1093/bioinformatics/btt113)把生物信息学资源拆成四个正交部分：`Topic`、`Operation`、`Data` 和 `Format`，用于标注工具、工作流、数据库、数据集、标准和培训材料，并支持工具发现与工作流组合。

- 优点：结构简单、可执行，明确区分数据、格式和操作；已经用于工具注册和工作流系统。
- 局限：主要来自生物信息学，脑科学覆盖不完整；没有认知范式、神经干预和科学证据约束。
- BrainPilot 用法：将其作为技能注册和路由层的直接设计范例：每个技能声明主题、操作、输入数据、输出数据、格式、前提和质量约束。

[EDAM-bioimaging](https://doi.org/10.7490/f1000research.1116432.1)也说明这种模式可以通过领域扩展覆盖成像操作。

### 13. INCF：标准协调层

[International Neuroinformatics Coordinating Facility（INCF）](https://doi.org/10.1007/s12021-020-09509-0)建立了神经科学标准和最佳实践的评估、认可及协调流程。其综述明确指出当前既缺乏经过验证、广泛采用的标准，也存在大量重叠、未成熟或低采用率标准。

- 优点：可用于判断哪些标准值得进入 BrainPilot 的 canonical registry。
- 局限：提供治理和认可机制，不提供覆盖 BrainPilot 全部维度的统一本体。
- BrainPilot 用法：给外部词表和标准记录成熟度、认可状态、版本、维护活跃度和采用证据。

## 横向比较

符号：`●` 为核心覆盖，`○` 为部分覆盖，`—` 为基本不覆盖。

| 工作 | 全领域/尺度 | 模态/技术 | 实验范式 | 科学/分析任务 | 科研过程 | 工具可执行映射 |
|---|---:|---:|---:|---:|---:|---:|
| NIFSTD | ● | ○ | ○ | ○ | ○ | ○ |
| openMINDS | ○ | ● | ○ | ● | ● | ○ |
| Cognitive Atlas | — | — | ● | ○ | — | — |
| CogPO | — | — | ● | — | ○ | — |
| BrainMap taxonomy | — | ○ | ● | ○ | ○ | ○ |
| RDoC | ○ | — | ● | ○ | — | — |
| BIDS | — | ● | ○ | — | ○ | ● |
| NWB | — | ● | ○ | — | ○ | ● |
| HED | — | ○ | ● | — | ○ | ● |
| NIDM-Terms/Neurobagel | — | ○ | ○ | — | ○ | ○ |
| OBI | ○ | ○ | ○ | ○ | ● | ○ |
| EDAM | ○ | ○ | — | ● | ● | ● |
| INCF | ○ | ● | ○ | ○ | ○ | — |

没有一行能覆盖所有列。最接近 BrainPilot 的方案不是选择其中一个，而是组合：

1. **NIFSTD/openMINDS**：领域对象、技术和标准概念；
2. **Cognitive Atlas/CogPO/HED**：认知构念、范式、条件和事件；
3. **BIDS/NWB/OME/NeuroML 等**：具体数据生态；
4. **OBI/NIDM/PROV**：研究过程和溯源；
5. **EDAM**：分析操作、输入输出与工具/技能注册；
6. **BrainPilot 自有层**：科学目标、验证要求、证据等级、能力状态和智能体路由。

## 对“有多少种模态、多少种任务”的直接启示

现有项目没有给出一个跨领域、无歧义的数字，原因不是统计工作尚未完成，而是不同项目在统计不同实体：

- BIDS 同时区分 `modality` 与 `datatype`；
- openMINDS 区分 `experimental approach`、`technique`、`measured signal`、`analysis technique` 和 `stimulation technique`；
- Cognitive Atlas 统计的是命名认知任务和构念；
- CogPO/HED 描述任务内部条件与事件；
- EDAM 统计的是可执行 operation；
- RDoC 的 paradigm 是分析单元之一，而不是所有科研任务。

BrainPilot 应分别发布以下数字，不能合成一个总数：

1. 观测模态家族数；
2. 观测模态标准子类数；
3. 干预方式家族与子类数；
4. 命名实验范式数；
5. 范式构成元素数（刺激、指令、反应、事件）；
6. 科学目标类型数；
7. 分析操作类型数；
8. 科研流程任务类型数；
9. 数据格式数。

每个数字都需要同时给出本体版本、层级深度、去重规则和统计日期。

## BrainPilot 的可区分创新点

BrainPilot 的创新不应表述为“第一个脑科学本体”。更可信的定位是：

> 将已有脑科学本体、实验范式、数据标准和分析操作连接成一个面向科研智能体的可执行能力图谱，并持续计算数据集、技能、工具和验证覆盖率。

建议新增的关系包括：

- 科学问题 `requires` 哪些观测或干预；
- 实验范式 `operationalizes` 哪些构念；
- 数据模态 `supports` 哪些分析操作；
- 分析操作 `accepts/produces` 哪些数据对象；
- 技能/工具 `implements` 哪些操作；
- 数据集 `instantiates` 哪些物种、尺度、模态和范式组合；
- 结论 `requires_validation` 哪种统计、复现、外部验证或因果证据；
- BrainPilot 能力 `has_status`：未覆盖、知识支持、可执行、已验证、生产可用。

这层关系正是现有标准普遍没有覆盖、而 BrainPilot 产品真正需要的部分。

## 建议的落地顺序

1. 先建立 crosswalk，不修改现有技能目录：为 74 个现有技能和 12 个数据集增加多轴标签。
2. 以 openMINDS technique/analysisTechnique 为首批候选词表，以 NIFSTD/InterLex 处理同义词和上位概念。
3. 用 Cognitive Atlas、CogPO 和 HED 建立实验范式层；将范式、科学目标和分析任务分表。
4. 用 BIDS/NWB 等标准标识输入输出数据，而不是自定义文件格式分类。
5. 参考 EDAM 为每个技能声明输入、输出、操作、前提条件和限制。
6. 生成第一张 `scale × modality × task × lifecycle` 覆盖热图，再决定新增技能和数据集优先级。

## 主要参考资料

- Bug et al. (2008), [NIFSTD and BIRNLex](https://doi.org/10.1007/s12021-008-9032-z)
- Poldrack et al. (2011), [The Cognitive Atlas](https://doi.org/10.3389/fninf.2011.00017)
- Turner & Laird (2012), [The Cognitive Paradigm Ontology](https://doi.org/10.1007/s12021-011-9126-x)
- Fox et al. (2005), [BrainMap taxonomy of experimental design](https://doi.org/10.1002/hbm.20141)
- Cuthbert & Insel (2013), [The seven pillars of RDoC](https://doi.org/10.1186/1741-7015-11-126)
- Gorgolewski et al. (2016), [BIDS](https://doi.org/10.1038/sdata.2016.44)
- Rübel et al. (2022), [The NWB ecosystem](https://doi.org/10.7554/eLife.78362)
- Robbins et al. (2021), [HED](https://doi.org/10.1016/j.neuroimage.2021.118766)
- Queder et al. (2023), [NIDM-Terms](https://doi.org/10.3389/fninf.2023.1174156)
- Bandrowski et al. (2016), [OBI](https://doi.org/10.1371/journal.pone.0154556)
- Ison et al. (2013), [EDAM](https://doi.org/10.1093/bioinformatics/btt113)
- Abrams et al. (2022), [INCF as a standards organization](https://doi.org/10.1007/s12021-020-09509-0)

