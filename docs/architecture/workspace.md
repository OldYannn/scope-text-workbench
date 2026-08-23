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

## UX-1A 交互基础

桌面应用使用最小的 UI primitives（可复用基础控件），而不引入完整视觉框架。按钮层级固定为 `Primary`、`Secondary`、`Ghost` 和 `Icon`：主要的、会推进研究工作流的操作使用 Primary；导入、导出和预览使用 Secondary；辅助查看或管理操作使用 Ghost；Icon button 必须有 `aria-label`，并在仅图标时提供 Tooltip。

辅助工具不得改变主研究工作区的布局。长方法说明使用 Popover 或 Dialog，不得在页面内展开；独立助手工具使用由 Portal 渲染的右侧 Drawer / Dialog，打开后主结果保留在背景原位置。当前词频工作区据此提供：

- “指标说明”使用可点击、可键盘操作的 Popover，支持外部点击和 Escape 关闭；
- “停用词优化助手”使用右侧 Drawer，保留现有候选与 pending draft 逻辑；
- “查看实际词表”使用只读 Drawer，词语本身不可点击修改，只有明确的“保留该词”操作会进入 pending draft；
- 长任务继续在 workspace 内显示状态；短成功反馈使用轻量 notification，不能替代错误和长任务状态。

所有 Popover 与 Drawer 由 Radix 处理 Portal、焦点管理和默认关闭行为。Drawer 显式保存其外部触发控件的 ref，以保证 Escape、关闭按钮或 Overlay 关闭后焦点返回原触发位置；Overlay 使用 Radix 默认的外部点击关闭行为。

### 项目负责人说明

这些规则只调整研究者与现有功能交互的方式，不更改词频、停用词或项目数据的研究含义。它解决了辅助内容把结果表向下挤开的问题，并要求可能改变配置的操作具有明确按钮，降低误触导致研究配置变化的风险。
