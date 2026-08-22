# Stopword / Frequency GUI UAT

1. 打开一个已有有效 token 的项目，确认默认 profile 显示 `SCOPE 中文通用停用词表 v1`、`Draft` 和生效词数。
2. 依次切换“不使用停用词”、goto456、哈工大、百度、四川大学和项目自定义，确认 profile 名称、版本、词数变化且 token 不重新生成。
3. 增加一个词、删除该 addition；点击实际词表中的内置词将其加入 exclusions；关闭并重新打开项目，确认 additions/exclusions/resolved set 恢复。
4. 导入 UTF-8 TXT 停用词，确认文件复制到项目内部，原始绝对路径不成为运行依赖。
5. 运行词频，确认 raw / eligible / effective token count、TF、DF、Coverage、RF10K 与文档参与数可见。
6. 切换 TF、DF、Coverage、RF10K、词语排序并测试 Top 50/100/500/全部。
7. 打开可选停用词优化助手，确认候选文案和加入/保留/忽略操作；加入候选后确认只提示重新计算，不重新分词。
8. 导出 UTF-8 中文路径 CSV 和 XLSX，确认 CSV BOM，XLSX 包含“词频结果”和“分析说明”，且 manifest 与页面使用同一 resolved hash。
