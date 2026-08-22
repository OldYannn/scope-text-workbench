# 停用词资源来源与鸣谢

SCOPE 感谢 goto456/stopwords 作者对公开中文停用词资源的收集整理工作。项目负责人已取得其直接许可，可在注明来源和贡献的前提下用于本开源项目。

主要来源仓库：<https://github.com/goto456/stopwords>。本轮采用包内冻结快照，运行不依赖联网。由于本地冻结资源需要独立审计，四套参考 preset（中文通用、哈工大、百度、四川大学机器智能实验室）及 SCOPE v1 的 token 级 provenance matrix 保存在 `engine/src/scope_engine/resources/stopwords/provenance.tsv`。

| 资源 | repository URL | source commit SHA | accessed date | attribution |
| --- | --- | --- | --- | --- |
| goto456/stopwords（四套整理资源） | https://github.com/goto456/stopwords | `bf8b03b9d3709222804ae89578156d1a0d8bf2b2` | 2026-08-22 | 感谢 goto456/stopwords 作者的收集整理与许可 |

四套参考文件和 provenance 已冻结在 sidecar；后续更新必须产生新的 source SHA 和资源版本，不能只写在 commit message。

SCOPE v1 的整理仅保留高共识功能词和语言噪声，明确排除可能承载研究意义的内容词。资源许可证与 Apache-2.0 软件许可证分开处理，不附加强制引用条件。
