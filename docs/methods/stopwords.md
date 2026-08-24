# 停用词与词频分析（Milestone 2B）

## 项目负责人说明

默认目标是较高信噪比和可解释性，不是人为制造统计显著性。SCOPE 中文通用停用词表 v1 只收录高共识、低风险的功能词、指示词和明显语言噪声；`党`、`法`、`权`、`人`、`政策`、`社会` 等可能有研究意义的内容词不会因为单字、高频或高 DF 被自动删除。所有影响结果的处理都可见、可查看、可修改、可关闭、可撤销并写入 manifest。

## 方法

当前 SCOPE v1 冻结词数为 86（去重后，UTF-8 文本中的非注释非空行），状态为 `draft`，不是已经充分外部验证的 Public Alpha 词表。`已经` 与 `已經` 在 exact-token 模型下是两个独立 token。逐词来源与筛选说明见 provenance matrix。

分词完成后，保存的结构化 token sequence 是不可变基础数据。停用词是下游 filter：`tokens -> eligibility -> exact-token stopword filter -> frequency analysis`。只按完整 token 精确匹配，因此停用词 `的` 不会影响 `目的地` 或 `的确`。基础 token eligibility 默认过滤空字符串、空白和纯标点/符号；中文词、英文/字母、数字和单字词都保留。

TF（词频）是当前参与分析的全部文档中 token 的出现总次数；DF（文档频率）是至少出现一次该 token 的文档数量，同一文档重复出现不会重复增加 DF；`Coverage(w) = DF(w) / IncludedDocumentCount × 100%`；标准化词频统一称为“每万词，RF10K”，`RF10K(w) = TF(w) / EffectiveTokenCount × 10,000`。EffectiveTokenCount 是完成基础 eligibility 和当前停用词过滤后实际参与统计的 token 总数。系统同时记录 raw token count、停用词前 eligible token count、停用词后 effective token count。默认纳入所有已有有效 token 结果的文档，并明确报告“参与数 / 总数”和未分词或失效文档数。

## Stopword Profile

profile 由 `builtin_profile + optional text-type extension profiles + custom additions - custom exclusions` 解析为 resolved stopword set。当前不预填未经方法审查的文本类型词项，但模型已支持学术、访谈、政策、新闻和社交媒体扩展。项目保存 additions、exclusions、resolved set、SHA-256、profile ID/version、执行时间；用户导入的 UTF-8 TXT 会复制到项目 `stopwords/`，不依赖原始绝对路径。内置 v1 当前是 `draft`；标记为 `released` 后不会静默修改，变更必须创建 v1.1/v2 并写入 CHANGELOG。

## 候选停用词检查

候选停用词检查不是自动判定“无意义词”，也不会删除任何词。它只显示尚未在 resolved set 中、满足 `Document Coverage >= 80%` 的高频广泛分布词，供研究者人工加入、保留、忽略或撤销。Candidate rule v1 固定为 Coverage >= 80%、最多 100 项、按 TF descending；候选逻辑透明、可审计，不使用 LLM，且仍属于待多类型语料验证的方法候选规则。每个候选同时显示 TF、DF 与 Coverage，使研究者能够理解其“出现多且覆盖广”的推荐原因。

## 可复现与导出

每次频率分析保存 Frequency Analysis Manifest，包括文档范围、分词依赖和 hash、停用词 profile/hash、三个 token 计数、公式、实现版本、执行时间和 `network_used=false`，并保存 resolved stopword snapshot。CSV 使用 UTF-8 BOM；XLSX 包含“词频结果”和“分析说明”两个 sheet，两者与 GUI 使用同一组中文表头。停用词编辑先进入 pending draft，修改前结果保留但标记 stale 且不可导出；一次应用后才使旧频率失效并重新计算，永不重新分词或改写 token。

研究者应在论文中报告实际 profile 版本、resolved hash、文档范围和 eligibility 规则。停用词选择可能改变排行榜和相对频率，不能把默认表视为适合所有研究问题的客观真理。
