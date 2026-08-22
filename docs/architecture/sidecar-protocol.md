# SCOPE sidecar 通信协议

## 状态与范围

本文定义桌面壳与 Python 分析引擎之间的 `0.1` 开发协议。目前覆盖项目、清洗、分词、停用词 profile、词频分析与导出。

传输格式为 UTF-8 NDJSON（Newline-Delimited JSON，每行一个完整 JSON 对象）。桌面壳把请求写入分析引擎的标准输入；分析引擎把协议消息写入标准输出，把供开发者阅读的诊断信息写入标准错误。生产和验证端的 subprocess consumer 必须显式使用 `encoding="utf-8", errors="strict"`，不能依赖操作系统 locale；错误 UTF-8 必须失败，不能替换或忽略。

## 兼容规则

- 每个请求和响应都必须包含 `protocol_version`；
- `0.1` 阶段要求双方版本完全一致；
- 在 `0.1` 内新增可选字段属于向后兼容；
- 删除字段或改变字段含义必须升级协议版本；
- 未知字段原则上应忽略，但如果接受它会改变研究行为，则必须拒绝；
- 未知方法返回结构化错误。

## 请求 envelope（消息外壳）

```json
{"protocol_version":"0.1","request_id":"req-1","method":"system.describe","params":{}}
```

必填字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `protocol_version` | string | 调用方使用的协议版本 |
| `request_id` | non-empty string | 把同一次请求的所有输出关联起来 |
| `method` | non-empty string | 请求执行的方法名称 |
| `params` | object | 方法所需参数 |

## 输出 envelope

成功结束：

```json
{"protocol_version":"0.1","request_id":"req-1","type":"result","result":{"engine_version":"0.0.0","protocol_version":"0.1","capabilities":["system.describe"]}}
```

失败结束：

```json
{"protocol_version":"0.1","request_id":"req-1","type":"error","error":{"code":"method_not_found","message":"Unknown method: example","details":{}}}
```

为 diagnostic tracer bullet（诊断性贯穿切片）预留的进度消息：

```json
{"protocol_version":"0.1","request_id":"req-2","type":"progress","progress":{"current":1,"total":10,"message":"Diagnostic step 1 of 10"}}
```

每个被接受的请求必须且只能产生一个最终 `result` 或 `error`，在此之前可以产生零个或多个 `progress`。

## 方法

### `system.describe`

`params` 必须是 object，目前没有定义内部字段。返回内容包括：

- `engine_version`：分析引擎版本；
- `protocol_version`：分析引擎实现的协议版本；
- `capabilities`：当前引擎支持的方法名称，按字母排序。

当前公开能力还包括 `stopwords.profiles`、`stopwords.get`、`stopwords.resolve`、`stopwords.import`、`frequency.analyze`、`frequency.latest` 和 `frequency.export`。冻结验证会直接调用这些能力，确保离线安装包包含停用词资源。

该方法不会修改项目，也不需要网络。

### `diagnostic.run`

该方法只用于 Milestone 0 技术验证，不读取语料，也不产生研究结论。

`params`：

| 字段 | 类型 | 限制 | 含义 |
|---|---|---|---|
| `steps` | integer | 1–20 | 需要完成的确定性步骤数 |
| `delay_ms` | integer | 0–1000 | 每个步骤之间的等待毫秒数，只用于制造可观察进度 |

每完成一步发送一个 `progress`。成功结果包含 `completed_steps` 和 `reproducibility_manifest`：

```json
{"protocol_version":"0.1","request_id":"req-2","type":"result","result":{"completed_steps":3,"reproducibility_manifest":{"operation":"diagnostic.run","operation_version":"1","parameters":{"steps":3,"delay_ms":10},"software":{"engine_version":"0.0.0","protocol_version":"0.1"},"random_seed":null,"input_hashes":[],"network_used":false}}}
```

### `request.cancel`

`params` 必须包含非空字符串 `target_request_id`。如果目标 diagnostic 仍在运行，返回 `accepted: true`；目标请求随后以 `cancelled` 错误结束。已经结束或不存在的目标返回 `accepted: false`。

```json
{"protocol_version":"0.1","request_id":"cancel-1","method":"request.cancel","params":{"target_request_id":"req-2"}}
```

### `diagnostic.crash`

该方法只用于验证 Rust 对分析引擎异常退出的处理。它接收空 `params`，并让 Python 进程以约定的非零状态退出，因此不会产生正常终结消息。Rust 必须把等待请求标记为 `engine_exited`，下一次新请求再启动新进程；不得自动重放崩溃前的请求。

### `project.create`

`params` 包含非空 `name` 和 `parent_path`。引擎在指定位置创建项目目录，返回项目概览与空文档列表。项目名称遵循 Windows 和 macOS 都可使用的文件名限制；目标目录已经存在时明确失败。

### `project.open`

`params` 包含 `project_path`。引擎验证项目目录版本和数据库版本，返回项目概览与已保存的文档列表。未知版本不得被静默升级。

### `corpus.import_txt`

`params` 包含 `project_path` 和非空 `file_paths` 数组。本协议版本只支持 `.txt`，编码只接受严格 UTF-8 与 UTF-8 BOM。每个文件独立返回 `imported`、`empty`、`duplicate` 或 `failed`；单个文件失败不阻止其他文件导入。

成功文档元数据包含 `document_id`、原始文件名、来源路径、导入时间、字符数、文件大小、输入哈希、格式、编码和导入状态。每次新增文档同时返回并保存最小 `reproducibility_manifest`，记录软件版本、项目与文档标识、文件哈希、导入时间、格式、编码、大小和 `network_used: false`。

### `document.get`

`params` 包含 `project_path` 和 `document_id`。返回已保存文档元数据及严格解码后的原始文本，用于本地预览。

### `tokenization.dictionary.import`

`params` 包含项目路径和用户选择的 UTF-8 词典文件路径。引擎把词典副本保存到项目 `dictionaries/`，返回词典 ID、名称、大小和 SHA-256；原始文件不会被修改。导入新词典会使已有 token 结果失效，必须明确重新运行。

### `text.tokenize.preview` / `text.tokenize.execute`

`params` 包含 `project_path`、`document_id` 和 `{mode, hmm, dictionary_id}`。两种方法都只读取文档的 `analysis_text`；未生成分析文本时返回 `analysis_text_missing`，不会回退到 `text`。`execute` 保存结构化 `tokens` 数组和 tokenizer manifest，记录 jieba 版本、模式、HMM、输入 hash、用户词典 hash、实现版本和执行时间。

### `stopwords.profiles` / `stopwords.get` / `stopwords.resolve` / `stopwords.import`

桌面端可以读取内置 profile、读取项目当前 resolved profile、保存 `base_profile_id`、`custom_additions`、`custom_exclusions`，以及导入 UTF-8 TXT。profile 变化只使 frequency result 失效，不修改 token sequence。

### `frequency.analyze`

`params` 包含 `project_path` 和可选 `profile_config`。profile_config 明确传递 base profile、extension profiles（当前为空）和 custom additions/exclusions。返回 TF、DF、Coverage、RF10K、raw/eligible/effective token count 及 manifest。

### `frequency.export`

`params` 包含项目路径、系统保存选择器批准的 `destination` 和 `format`（`csv` 或 `xlsx`）。导出使用已保存且仍有效的 frequency result，不重新计算或替换 profile。

## 错误代码

| 代码 | 含义 |
|---|---|
| `invalid_json` | 输入行不是合法 JSON |
| `invalid_request` | 消息外壳或必填字段不合法 |
| `incompatible_protocol` | 调用方与分析引擎的协议版本不一致 |
| `method_not_found` | 分析引擎不支持该方法 |
| `invalid_params` | 方法参数不符合定义 |
| `request_id_in_use` | 相同 `request_id` 的任务仍在运行 |
| `cancelled` | 目标任务已按请求取消 |
| `internal_error` | 分析引擎出现意外错误；详细信息不得暴露 Secret |
| `invalid_project_name` | 项目名称为空或不满足跨平台文件名限制 |
| `project_location_unavailable` | 项目保存位置不可用 |
| `project_already_exists` | 同名项目目录已经存在 |
| `invalid_project` | 项目元数据或数据库缺失、损坏或不可读 |
| `unsupported_project_version` | 项目目录或数据库版本不受支持 |
| `unsupported_format` | 导入文件不是当前支持的 TXT |
| `unsupported_encoding` | TXT 不是严格 UTF-8 或 UTF-8 BOM |
| `file_read_failed` | 文件不存在或无法读取 |
| `import_failed` | 文件已读取，但无法安全保存到项目中 |
| `document_not_found` | 项目中不存在指定文档 |
| `analysis_text_missing` | 文档尚未生成分析文本，分词不会静默使用原始文本 |
| `dictionary_read_failed` | 用户词典不可读取或不是 UTF-8 |
| `dictionary_not_found` | 项目中不存在指定用户词典 |
| `unsupported_tokenization_mode` | 当前版本不支持请求的分词模式 |

如果无法恢复有效 `request_id`，分析引擎使用 `null`。损坏输入不能导致长期运行的分析引擎崩溃。

## 生命周期与取消

取消优先采用 cooperative cancellation（协作式取消）：任务定期检查取消信号并安全结束。若进程长时间无响应，Rust 桌面壳可以在记录原因后终止并重启进程。被取消或终止的任务不得记录为成功的研究结果。

## 安全与可复现规则

- 协议输出不得包含 API Key 或 Token；
- 标准输出只用于协议消息；
- 文件访问使用桌面壳批准的路径或项目相对引用；
- 未来任何可能影响研究结果的操作，都必须记录方法版本、参数、输入哈希、软件版本和适用的随机种子。
