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
