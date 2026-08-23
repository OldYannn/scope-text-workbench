# 文本清洗（Milestone 1B）

文本清洗把每篇文档分成两个明确层次：`text` 是导入后保存的 Raw / Original Text，永不被清洗覆盖；`analysis_text` 是按规则生成、供后续分词和统计分析使用的 Analysis / Cleaned Text。

第一版规则包括空白字符规范化、换行规范化、URL 删除、HTML 标签清理，以及可选的标点删除。规则配置、输入 SHA-256、实现版本 `1`、执行时间和原始文本与分析文本的派生关系会写入项目数据库的清洗字段与 `audit_events`。相同输入、规则和实现版本得到一致结果。

项目打开时会自动把旧的 schema 1 数据库迁移到 schema 2，原始文件 `corpus/original/` 不会被写入或替换。清洗预览只计算结果，执行后才保存分析文本；关闭并重新打开项目会恢复分析文本和配置。

## 批量清洗与失效

`text.clean.batch` 默认只处理尚未清洗的文档；“重新清洗全部文档”先显示原始文本不变、分词与下游结果失效的影响，只在用户明确确认后执行。每篇文档独立提交，单篇失败不回滚其他成功结果；取消在当前文档完成后生效，并保留已完成部分。重新生成某篇 `analysis_text` 会清除该篇旧 tokens，并使 frequency results 失效，原始 `text` 永不修改。

未来 Analysis Exclusion Masks 位于 `Raw Text -> Cleaned Analysis Text -> Exclusion Masks -> Effective Analysis Text -> Tokens`。mask 保存 start/end、selected text、input hash 与配置 hash；清洗改变 input hash 时不得静默套用旧 mask。该方向本轮只记录，不实现为删除文本。
