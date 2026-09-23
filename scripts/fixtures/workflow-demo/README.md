# Synthetic workflow demonstration input

This fixture supports a short screen-share demonstration of the real paper-writing workflow. Every study label and numeric value is synthetic and supplied only to exercise writing, citation handling, LaTeX output, and artifact delivery. No participants were recruited, no EEG was recorded, no preprocessing code was run, and no statistic was calculated. Do not describe the mini-manuscript as an empirical result or evidence that either strategy improves classification.

The input compares two named toy protocols: no added temporal smoothing and a three-point moving-average smoothing step. The supplied means and paired-test p value are fixed illustrative inputs, not outputs computed from records. No participant-level data, classifier configuration, filter implementation, uncertainty interval, or replication is provided.

Copy only `raw_materials/` and `latex_template/` into the demo workspace at `/workspace/materials/`. The README and the screen-share prompt are operator instructions, not research evidence. Keep the synthetic label in the title or abstract and Methods. The empty `figures/info.json` is intentional; no figure asset is supplied.

## Paste-ready request

```text
请使用 PaperOrchestra 写作工作流，基于本工作区的材料完成一篇简短的 LaTeX 方法与方案说明稿，并交付可编辑的 .tex 和 PDF：
- 原始材料目录：/workspace/materials/raw_materials
- LaTeX 模板目录：/workspace/materials/latex_template

主题是比较“无额外时间平滑”和“三点移动平均平滑”这两个合成 EEG 分类预处理方案。请按模板结构写成约一页的短稿。`idea_sparse.md`、`experimental_log.md` 和模板是本示例的事实来源。

这只是合成工作流演示：没有真实参与者、EEG 记录、已运行的预处理代码或计算出的统计结果。表格中的 n=8、均值、差值和 p 值均为预先提供的玩具输入，不得称为真实测量或自行重算、扩展。明确保留 p=0.42 的非显著结果；不要声称效果已成立。不要补造分类器细节、置信区间、原始数据、验证或复现。

请正常使用工作流原生的文献检索和来源核验。最多引用一篇本次确实检索并核验过的背景文献，且只用于介绍方法或报告规范；它不能作为这些合成数值或比较结果的证据。如果没有合格来源，就不加引用，不要凭记忆补造。请按模板完成简短稿件，并提供最终 TeX 和 PDF 文件。
```

For a live run, allow several minutes or longer for writing, review, compilation, and artifact delivery. A completed workflow demonstrates software execution and output delivery only; it does not validate a scientific effect or the scientific quality of the generated text.
