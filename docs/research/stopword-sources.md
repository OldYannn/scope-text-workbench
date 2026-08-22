# 停用词资源来源与鸣谢

SCOPE 感谢 goto456/stopwords 作者对公开中文停用词资源的收集整理工作。项目负责人已取得其直接许可，可在注明来源和贡献的前提下用于本开源项目。

主要来源仓库：<https://github.com/goto456/stopwords>。四套 preset 现在均为该 commit 的完整 upstream snapshot，原始文件保存在 `engine/src/scope_engine/resources/stopwords/upstream/`，runtime normalized 文件和完整 token-level provenance 由固定脚本生成。运行不依赖联网。

| 资源 | repository URL | source commit SHA | accessed date | attribution |
| --- | --- | --- | --- | --- |
| goto456/stopwords（四套整理资源） | https://github.com/goto456/stopwords | `bf8b03b9d3709222804ae89578156d1a0d8bf2b2` | 2026-08-22 | 感谢 goto456/stopwords 作者的收集整理与许可 |

四套参考文件和 provenance 已冻结在 sidecar；后续更新必须产生新的 source SHA 和资源版本，不能只写在 commit message。

| preset | raw line count | unique token count | raw SHA-256 | normalized SHA-256 |
| --- | ---: | ---: | --- | --- |
| goto456-general | 746 | 746 | `5c8d5dd24906615de61ae4056f9261b6fb9f42f58bc75f442fe1032b511dc04b` | 见 `profiles.json` |
| hit | 767 | 749 | `84e526454db0245cab0d167df067f00298d271ad2c86391d45f5e880c422cbae` | 见 `profiles.json` |
| baidu | 1396 | 1395 | `b11ff810ee5c8934dc46b57f3a1ba85457e3893e89acdafb5cd286570fe793a3` | 见 `profiles.json` |
| scu | 976 | 860 | `2c325256276f2c4ed5ec076178c08494af7a46bf44d0b9be2fc0214d5b606d41` | 见 `profiles.json` |

`provenance.tsv` 共 2312 个 token 行（不含表头），字段为 `token`、四个明确 0/1 来源字段、`source_count`、`scope_v1_included`、`category`、`note`。它可由固定脚本重新生成并逐字节比较。

SCOPE v1 的整理仅保留高共识功能词和语言噪声，明确排除可能承载研究意义的内容词。资源许可证与 Apache-2.0 软件许可证分开处理，不附加强制引用条件。
