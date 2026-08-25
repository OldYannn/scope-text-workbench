# SCOPE 中文通用 v1 Draft 停用词验证协议

## 项目负责人说明

本协议不试图用一次自动计算决定停用词表是否“正确”。它提供可重复的比较材料，让项目负责人和方法审查者能够基于不同体裁的真实语料，判断 SCOPE 中文通用 v1 Draft 是否适合作为非技术人文社会科学用户的保守默认方案。默认停用词宁可相对保守，也要避免删除可能承载研究含义的 token。

## 研究问题与范围

研究问题是：SCOPE 中文通用 v1 Draft 是否适合作为非技术人文社会科学用户的安全默认停用词方案？

验证必须分别使用政策文本、访谈文本、学术文本三类本地语料。每篇 UTF-8 或 UTF-8 BOM TXT 是一份文档；Harness 递归读取目录。它不支持 GBK 自动识别，读取失败会明确终止运行，绝不静默跳过文档。

每类语料分别比较三种固定配置：

- No Stopwords
- SCOPE 中文通用 v1 Draft
- goto456 中文通用（仓库内已固定的资源快照）

本轮不比较 HIT、Baidu、SCU，也不涉及 TF-IDF、TextRank 或其他关键词算法。SCOPE v1 的 86 个 exact-token 继续保持 `draft`，其中 `已经` 和 `已經` 是两个独立 token；Harness 不会修改它们。

## 运行方式与本地数据边界

真实语料和输出均为本地材料，默认被 Git 忽略：`validation-corpora/`、`validation-output/` 与 `validation/stopwords/config.local.json`。不得提交真实访谈、受版权保护内容、项目内部材料或其输出。

从 [config.example.json](../../validation/stopwords/config.example.json) 复制出本地配置，并按自己的本地目录填写路径。配置中的相对路径相对于配置文件所在目录解析。

```shell
cp validation/stopwords/config.example.json validation/stopwords/config.local.json
python3 scripts/validate_stopwords.py --config validation/stopwords/config.local.json
```

目录可按以下结构组织；`topic-*` 只是便利分组，非强制要求：

```text
validation-corpora/
├── policy/
├── interview/
└── academic/
```

Harness 只读 corpus，不创建或修改 SCOPE 项目、不写入数据库、不改写语料、不使用项目用户词典，也不联网。输出不记录绝对路径、原始全文、长摘录或源文件名；文档在运行内使用 `document_001` 这类匿名 ID。每个 corpus 的 aggregate hash 由排序后的“相对逻辑文档 ID + raw-byte SHA-256”计算，因此不依赖文件遍历顺序、mtime 或本机路径。

配置中的可选 `notes` 仅保留在本地 config，绝不会复制到任何可分享输出；不要用它作为记录真实语料文件名或敏感信息的渠道。

## 方法与可复现性

Harness 直接调用正式引擎的 TXT UTF-8 解码、清洗、jieba 精确模式分词（`jieba==0.42.1`、`HMM=true`、无用户词典）、停用词 profile 解析、token eligibility 及 TF/DF/RF10K 统计实现。它不复制这些公式或另建一份分析算法。

每个 Corpus × Configuration 记录：DocumentCount、RawTokenCount、EligibleTokenCount、EffectiveTokenCount，以及按 TF 降序、token 确定性 tie-break 的 Top N（默认 100）词语、TF、DF、Coverage 和 RF10K。

`validation-manifest.json` 记录 run ID、时间、Git commit、引擎/实现版本、清洗与分词配置、jieba 版本、三个停用词配置及其 count/hash、goto456 固定来源 commit、各 corpus aggregate hash 与三组 token 计数，并明确 `network=false`。

## 人工复核

`manual_review_matrix.csv` 和对应 XLSX sheet 保留空白的“人工判断”“人工备注”列，允许研究者填写：保持为通用停用词、保留为内容词、仅适合作为文本类型扩展停用词、需要更多语料复核或不判断。程序绝不填写这些字段。

矩阵包含：

- Potential False Positive：SCOPE Draft 已删除 token 在 No Stopwords baseline 中的真实统计；
- Potential False Negative：SCOPE Draft 留下且满足既有 `Coverage >= 80%` candidate review flag 的 token；
- SCOPE vs goto456 Difference：baseline 中 token 的 `both remove`、`SCOPE only`、`goto456 only` 或 `neither` 状态。

Coverage 高、频率高都不自动等于“应成为停用词”。`watchlist.csv` 与 XLSX “争议词观察”会单独展示 `可能、因此、所以、通过、根据、作为、进行、出现、认为、表示` 在三类语料中的 baseline 统计及两套词表的删除状态；缺失词明确标为 `absent` 和 0。

## 输出与后续决定

每次运行生成 UTF-8 BOM CSV：`corpus_summary.csv`、三份 `<corpus>_comparison.csv`、`manual_review_matrix.csv`、`watchlist.csv`；还生成 `stopword-validation.xlsx`、`validation-summary.md` 与 `validation-manifest.json`。Markdown summary 只写观察事实，不输出方法结论或词表建议。

完成 Harness 或完成一次真实运行，都不能宣称“SCOPE 中文通用 v1 已通过验证”。正确流程是：真实三类 corpus → validation → manual review → 项目负责人决定。只有项目负责人明确决定后，才可另开 Release SCOPE 中文通用 v1 的任务；released 后不得静默修改，未来调整使用 v1.1 或 v2。
