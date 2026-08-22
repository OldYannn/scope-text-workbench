# 桌面工作区结构

SCOPE 的研究工作台保留左侧 Corpus sidebar。右侧 Main Workspace 使用四个互斥的工作区：文本、清洗、分词、词频。标签切换只改变当前视图，不清除 React state，也不重新执行任何分析。

- 文本：当前文档 metadata、原始文本和 analysis text 状态。
- 清洗：cleaning rules、before/after preview 和执行清洗。
- 分词：jieba 模式、HMM、用户词典、重新分词和 token result。
- 词频：Stopword Profile、resolved set、frequency result、Optimization Assistant 和 CSV/XLSX export。

Corpus sidebar 不随标签切换消失，主要滚动区域由 workspace 内容承担。原生窗口 `minWidth` 与 CSS usable minimum 固定为 980px，以保证侧栏、统计信息和工具栏在 Windows 桌面尺寸下不互相遮挡。
