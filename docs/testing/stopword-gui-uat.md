# Stopword / Frequency GUI UAT

## UAT #1（Windows production artifact）

基准 commit：`dad346b8dd4c16b2131b8cb2095eea6f71f405e9`，真实安装包测试结果：**FAIL / NOT READY**。

通过：Windows 安装和启动、无 `scope-engine-dev` 黑色 Console、TXT 导入、基础文本清洗、jieba 中文分词，以及关闭并重新打开项目后分词结果恢复。

未通过：最窄窗口仍有遮挡/溢出；Open Project 的 folder picker 无法显示 `project.json`；清洗、分词、停用词、词频纵向堆叠导致工作区拥挤；停用词下拉为空且生效/增加/保留数量和 resolved viewer 均为 0；手动增加缺乏反馈；看不到优化助手和 CSV/XLSX 导出；点击 TF/DF/RF10K 后没有可见结果。持久化基础结果正常。

结论：这是 production frozen-sidecar stopword/frequency workflow blocking issue，同时包含 workspace UX issues。修复前不执行 SCOPE v1 方法验证，也不进入 TF-IDF；修复后必须以 Windows production artifact 重新执行本清单，作为 UAT #2。

## Pre-UAT correction checklist

- 原生 Tauri `minWidth=980`，与 CSS workspace minimum 一致。
- Corpus sidebar 持续显示；右侧 workspace 按“文本 / 清洗 / 分词 / 词频”条件渲染，不通过 CSS 隐藏整页冒充标签。
- SCOPE v1 Draft 为 86 个 exact tokens；`已经` 与 `已經` 分别计数。

1. 打开一个已有有效 token 的项目，确认默认 profile 显示 `SCOPE 中文通用停用词表 v1`、`Draft` 和生效词数。
2. 依次切换“不使用停用词”、goto456、哈工大、百度、四川大学和项目自定义，确认 profile 名称、版本、词数变化且 token 不重新生成。
3. 增加一个词、删除该 addition；点击实际词表中的内置词将其加入 exclusions；关闭并重新打开项目，确认 additions/exclusions/resolved set 恢复。
4. 导入 UTF-8 TXT 停用词，确认文件复制到项目内部，原始绝对路径不成为运行依赖。
5. 运行词频，确认 raw / eligible / effective token count、TF、DF、Coverage、RF10K 与文档参与数可见。
6. 切换 TF、DF、Coverage、RF10K、词语排序并测试 Top 50/100/500/全部。
7. 打开可选停用词优化助手，确认候选文案和加入/保留/忽略操作；加入候选后确认只提示重新计算，不重新分词。
8. 导出 UTF-8 中文路径 CSV 和 XLSX，确认 CSV BOM，XLSX 包含“词频结果”和“分析说明”，且 manifest 与页面使用同一 resolved hash。

## UAT #2（Windows production artifact）

基准 commit：`144703667afd038415a89c74751695541109ee3f`。

通过：原生最小窗口、`project.json` 打开流程、文本/清洗/分词/词频工作区分类、停用词 profile 加载与项目自定义停用词操作。

UX 待修：停用词输入框“手动增加词语”语义不够明确，本轮改为“手动增加停用词”。

阻塞：点击“计算 TF / DF / RF10K”后没有当前工作区内可见的 running/success/error 状态和结果，导致 Optimization Assistant、CSV/XLSX 与 Frequency 关闭重开状态无法继续验收。Milestone 2B Gate 仍为 **NOT READY**，不进入 TF-IDF。

本次代码检查确认，Python frozen sidecar 和 Tauri `frequency_analyze` 转发能力已存在；GUI 问题来自 Frequency section 被放在 `corpus-workspace` 结束之后，结果落在主工作区之外，同时 `executeFrequency` 只有全局 notice、没有本地状态，也没有区分空结果。该问题不能通过增加提示文案替代，必须修正 workspace 结构和状态渲染。

## Milestone 2B.3 checklist

- [ ] Frequency 作为右侧 Main Workspace 的直接内容显示，而不是 corpus workspace 后的追加 section。
- [ ] 计算按钮提供 idle/running/success/error 状态，错误同时显示在 Frequency Workspace 内。
- [ ] 区分成功有 rows、成功但无参与文档、成功但过滤后无 rows。
- [ ] Optimization Assistant 与 CSV/XLSX 始终可见；未完成分析时 disabled 并说明原因。
- [ ] Windows GUI E2E 完成清洗 → 分词 → 词频，并断言固定 fixture 的 TF/DF/RF10K 与停用词过滤回归。
- [ ] `frequency.latest` 的项目重开恢复策略明确记录；在未接入完整 profile/result 恢复前，不把旧结果静默显示为当前有效结果。

## UAT #3 与 Milestone 2B.4

基准 commit：`c183de6923c8ef09cc14cd298dfd99c17b8799c8`。

通过：Frequency 可运行并显示结果；Stopword Profile 正常；CSV 可导出。

FAIL / UX：GUI 与 CSV 指标名不一致；逐项停用词编辑会立即清空 Frequency；缺少面向普通研究者的指标解释；真实 Excel 无法打开手写 OOXML XLSX；resolved viewer 裸点击会修改 keep words；几十/几百篇项目缺少批量清洗和分词。Manual Token Correction 与 Analysis Exclusion 是后续架构方向，不是本轮实现项。

## UAT #4 checklist

- [ ] GUI、CSV、XLSX 均显示“词频（TF）/文档频率（DF）/文档覆盖率/标准化词频（每万词，RF10K）”，不存在“每百万”表述。
- [ ] “指标说明”能用非 NLP 语言解释 TF、DF、Coverage、RF10K 和 EffectiveTokenCount。
- [ ] 连续增加多个停用词和助手候选时，旧表保持可见，显示 stale 与待应用数量；逐项撤销有效。
- [ ] pending 状态 CSV/XLSX 禁用；“应用修改并重新计算”只触发一次最终 resolve 和一次 analysis。
- [ ] resolved viewer 单击词语不修改配置；只有明确“保留该词”action 进入 pending。
- [ ] CSV 为 UTF-8 BOM；XLSX 可由真实 Excel 打开，含“词频结果”和“分析说明”sheet，中文表头/数据正确。
- [ ] 多篇语料默认批量清洗只处理未清洗文档；rerun 先提示失效影响并要求确认；进度、取消、失败文件及原因可见。
- [ ] 批量分词只处理已有 analysis_text 且未分词的文档；未清洗文档明确跳过；使用当前 HMM/用户词典。
- [ ] 项目概览的语料/已清洗/已分词计数正确，batch → frequency 闭环无需逐篇点击。
- [ ] 重新清洗清除受影响 tokens；重新分词与清洗都使旧 frequency 失效，原始文本不变。
