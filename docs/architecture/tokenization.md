# 中文分词架构与方法（Milestone 2A）

## 项目负责人说明

分词把已经准备好的 `analysis_text` 切成可复用的词元。原始 `text` 和分析文本都不会被分词覆盖。研究者可以导入自己的领域词典，例如“一肩挑”“基层治理”“三治融合”，再重新运行并在项目迁移后复现同一结果。

## v1 技术选择

SCOPE v1 固定使用 `jieba==0.42.1`。它轻量、本地运行、无需模型下载、跨平台打包成本低，支持用户词典且行为相对稳定、可解释，符合 Windows-first、local-first 的桌面科研软件定位。本轮不引入 HanLP、LTP、pkuseg 或其他引擎。

代码通过小型 tokenizer 边界函数调用 jieba；数据模型和 manifest 不把 SCOPE 永久锁死在 jieba 上。未来增加 backend 时，应保持相同的输入（`analysis_text`）、结构化 token 输出和可复现 manifest，并为新引擎单独记录版本与参数。本轮不建设插件系统或复杂抽象。

## 默认方法

- GUI 名称：标准分词（推荐）。
- `mode=accurate`，对应 jieba 精确模式。全模式和搜索引擎模式会产生重叠 token，不适合作为词频、TF-IDF 和共词分析的默认输入。
- `hmm=true` 默认开启，用于识别词典外新词；高级界面可关闭并在 manifest 中记录。
- 分词只接受 `analysis_text`。如果文档尚未执行清洗，返回“该文档尚未生成分析文本，请先执行文本清洗”，不静默使用原始文本。

## 用户词典与项目迁移

支持 jieba 标准用户词典格式：每行一个词，也可写为 `词语 [词频] [词性]`。原始用户文件只读读取，不会被修改。导入时复制字节到项目内 `dictionaries/<dictionary_id>.txt`，记录原文件名、大小、导入时间和 SHA-256；分词 manifest 记录实际使用的词典 ID、名称和 hash。复制整个项目文件夹到另一台电脑即可恢复，不依赖原路径。替换词典会产生新的 ID/hash，已有 token 结果不会被静默视为仍然有效，研究者需要重新运行。

## 结构化结果与 Manifest

`tokens` 保存为 JSON 数组，每项至少包含 `{ "index": 0, "token": "基层治理" }`。这样后续可以直接做词频、n-gram、共词、词性或位置扩展，而不需要从拼接字符串反解析。每次执行保存：`engine=jieba`、`engine_version=0.42.1`、`mode=accurate`、`hmm`、`input_analysis_text_hash`、默认词典 identity/version、用户词典 ID/名称/hash、`tokenization_implementation_version=1`、`executed_at` 和 `network_used=false`。默认词典不额外 hash Python 包内所有资源；版本和 `jieba-default` identity 已足以说明本次使用的默认词典来源。

## 与停用词和关键词分析的边界

本轮不删除停用词。分词和停用词过滤是两个阶段，后续词频分析再提供保守默认、版本化内置表和用户自定义表，并先核查许可证和来源。SCOPE 不把 `jieba.analyse.extract_tags()` 作为默认科研关键词算法；后续 TF-IDF 将在当前用户语料库内透明计算 document frequency / inverse document frequency，记录语料范围和参数。

## 验证与打包

固定 fixtures 覆盖中文句子、标点、空文本、中英文混合、数字、HMM on/off、用户词典前后差异、相同输入配置稳定性、词典 hash 稳定性、项目关闭重开、`text` / `analysis_text` 不变和 schema migration。`jieba==0.42.1` 是 sidecar 运行依赖；PyInstaller 构建必须收集 jieba 包及其默认词典资源。Windows x64、macOS arm64/x64 继续使用现有冻结 sidecar 流程，中文项目路径和用户词典路径由项目协议测试覆盖。

## 批量分词与未来人工纠正

`text.tokenize.batch` 默认只处理已有 `analysis_text` 且尚无 tokens 的文档；未清洗文档明确 skip/report。“重新分词全部已清洗文档”先显示 tokens 与下游结果失效的影响，用户确认后再使用同一 mode、HMM 和当前项目用户词典执行。任务逐篇提交，支持进度、取消和部分失败保留。

导入新词典会清除旧 token 结果并失效词频。如果用户重新选择项目内已存在的词典，引擎会保留 manifest 已记录使用该词典的 tokens，但会清除由其他词典或无词典配置生成的 tokens，防止 GUI 显示词典与实际分词输入不一致。

未来 Interactive Token Correction 不直接静默改写保存的 jieba sequence。研究者选择相邻 token，例如“基层 / 治理”，执行“合并为基层治理”后，系统把决定保存为项目词典或 correction rule，再重新分词。规则必须可查看、可撤销、可复现并进入 manifest；forced split 属于更后续范围，本轮不实现。
