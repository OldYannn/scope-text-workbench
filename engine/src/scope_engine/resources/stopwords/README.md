# 停用词资源

这些文本文件随 SCOPE sidecar 冻结发布，运行时不联网。`upstream/` 保存 goto456/stopwords commit `bf8b03b9d3709222804ae89578156d1a0d8bf2b2` 的四个原始快照；同级文件是由 `generate_provenance.py` 确定性生成的 normalized runtime profile。完整来源、hash、unique count 和鸣谢见 [`docs/research/stopword-sources.md`](../../../../../../docs/research/stopword-sources.md)。

运行脚本：`python generate_provenance.py`。脚本会重建四套 profile 和完整 token-level `provenance.tsv`，避免手工维护漂移。
