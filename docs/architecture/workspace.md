# 桌面工作区结构

SCOPE 的研究工作台保留左侧 Corpus sidebar。右侧 Main Workspace 使用四个互斥的工作区：文本、清洗、分词、词频。标签切换只改变当前视图，不清除 React state，也不重新执行任何分析。

- 文本：当前文档 metadata、原始文本和 analysis text 状态。
- 清洗：cleaning rules、before/after preview 和执行清洗。
- 分词：jieba 模式、HMM、用户词典、重新分词和 token result。
- 词频：Stopword Profile、resolved set、frequency result、Optimization Assistant 和 CSV/XLSX export。

Corpus sidebar 不随标签切换消失，主要滚动区域由 workspace 内容承担。原生窗口 `minWidth` 与 CSS usable minimum 固定为 980px，以保证侧栏、统计信息和工具栏在 Windows 桌面尺寸下不互相遮挡。

## Frequency 状态规则

词频是右侧 Main Workspace 的直接内容，不在 corpus workspace 之后追加成长页面。用户触发任何分析任务时，当前工作区必须立即显示 `running` 状态；完成后显示 `success` 和参与文档/有效 token 数；失败显示 `error` 和可理解的重试提示。全局 notice 可以保留用于审计，但不能是唯一反馈位置。

成功但参与文档为 0、以及参与文档大于 0 但过滤后 rows 为空，分别显示可操作的空结果说明，不得伪装成执行失败。Optimization Assistant 与 CSV/XLSX 入口始终可见，未完成有效词频分析时 disabled 并说明“请先完成词频分析”。

## Corpus-level execution

语料级分析软件必须为确定性的预处理操作提供 corpus-level execution；逐文档控件用于检查和例外处理，不能是唯一执行路径。清洗与分词工作区同时保留单篇预览/执行，并提供批量执行、eligible 数量、X/N 进度、取消、逐篇成功/失败与最终摘要。重新处理全部文档前必须在当前工作区显示对分词/下游结果的失效影响并要求明确确认。只要有文档处理成功，前端必须移除已失效的旧词频结果；部分失败需列出文件名和原因。左侧 Corpus sidebar 始终可用，项目概览显示语料总数、已清洗数和已分词数。

Frequency 的停用词编辑采用“已应用配置 + pending draft”。连续增加、保留或处理助手候选时，修改前结果继续可见并明确标记 stale；导出禁用。只有“应用修改并重新计算”才保存最终 resolved profile 并执行一次词频分析。
