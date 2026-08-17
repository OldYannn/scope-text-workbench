# ADR 0001：Tauri 桌面壳与 Python sidecar 架构

- 状态：Milestone 0 已接受
- 日期：2026-08-10
- 决策者：SCOPE 项目维护者

ADR（Architecture Decision Record，架构决策记录）用于保存重要技术选择及其原因，避免以后只看到代码，却不知道当初为什么这样设计。

## 项目负责人说明

- 为什么需要：SCOPE 既需要适合普通研究者的桌面界面，也需要使用成熟的 Python 文本分析生态。
- 解决的问题：Tauri 负责桌面应用和系统能力，Python 负责研究算法和项目数据，两者通过稳定协议协作，避免界面与研究方法互相绑死。
- 主要风险：跨平台打包链较长；每个平台都要包含可运行的 Python 程序；代码签名、杀毒软件误报和不同系统 WebView 的差异仍需实测。
- 需要项目负责人决策：正式 Bundle ID、Package Name 和公开发布仍未确定；如果主架构无法稳定打包，是否切换 Electron 必须另行确认。项目已采用 Apache License 2.0。

## 背景

SCOPE 必须提供跨平台桌面体验，同时继续使用 Python 的研究工具生态。软件需要保持本地优先、结果可复现、AI Provider 中立，并能由规模较小的开源团队长期维护。

架构比较包括：

1. Tauri 2 + React / TypeScript + 薄 Rust 桌面壳 + 打包后的 Python sidecar；
2. Electron + React / TypeScript + 打包后的 Python sidecar；
3. 本地 FastAPI + pywebview。

研究分析引擎必须独立于用户界面。正式安装包不能要求用户另行安装 Python、Node.js 或 Rust。

## 决策

Milestone 0 采用：

- React 和 TypeScript 负责用户界面；
- Tauri 2 和薄 Rust 桌面壳负责窗口、系统权限、获批路径、应用更新和 sidecar 生命周期；
- 打包后的 Python sidecar 独占研究算法、项目存储、SQLite、结果持久化、默认参数和研究审计记录；
- 使用带版本号的 UTF-8 NDJSON（每行一个 JSON 对象）通过标准输入和标准输出通信；
- 大型语料和分析结果只传递项目内引用与哈希，不在协议消息中复制整份数据。

Rust 和 Python 不得同时写入项目数据库。Rust 可以校验路径和管理进程，但研究行为与项目状态属于 Python。

本地分析默认离线运行。未来在线模型 Provider 将作为可选 Adapter（适配器）存在，不属于本地 sidecar 生命周期的一部分。

## 模块职责

| 模块            | 负责                                           | 不负责                                 |
| --------------- | ---------------------------------------------- | -------------------------------------- |
| React UI        | 界面呈现、表达用户操作意图、显示进度和友好错误 | 研究算法、SQLite 写入、Provider Secret |
| Rust 桌面壳     | 系统能力、路径许可、sidecar 生命周期、协议传输 | 研究默认值、研究计算、项目数据库写入   |
| Python 分析引擎 | 项目状态、研究方法、参数、结果和溯源信息       | 桌面窗口行为、在线 Provider 界面       |

## 协议边界

桌面应用与 Python 分析引擎之间的公共 seam（可替换和测试的接口位置）定义在 `docs/architecture/sidecar-protocol.md`。协议版本独立于软件版本。未知方法、损坏消息和不兼容版本必须返回结构化错误，不能让进程无提示退出。

## 打包规则

正式安装包必须包含对应平台的冻结 Python 可执行文件。Tauri sidecar 文件名需要包含打包工具要求的 target triple（目标平台三元组）。仅在开发电脑上借助系统 Python 成功运行，不算完成打包验证。

Milestone 0 打包目标：

- Windows x64；
- macOS arm64；
- macOS x64。

首个 Public Alpha 对 Linux 只提供尽力支持，不作为必达目标。

## 影响与代价

主要收益：

- 用户界面可以变化，而不必重写研究算法；
- Python 研究依赖被集中在一个独立进程内；
- 最终用户不需要安装 Python；
- 进程隔离让取消任务和处理引擎崩溃具有清晰位置。

主要代价：

- 每个目标平台都要生成并验证 Python 可执行文件；
- 协议升级需要兼容性测试；
- 调试可能跨越 TypeScript、Rust 和 Python；
- 代码签名、公证和杀毒软件误报仍是发布风险。

## Electron 回退条件

Electron 是回退方案，不与 Tauri 并行开发。只有 Milestone 0 的限时验证出现以下情况之一，才重新评估桌面壳：

- 冻结后的 Python sidecar 无法在要求的平台上可靠打包或启动；
- 代码签名或公证无法生成可安装产物；
- WebView 差异阻碍必要界面行为，且没有可维护的解决方案；
- Rust / Tauri 工具链持续产生与产品价值不相称的维护成本。

任何回退都需要新 ADR，并取得项目负责人批准。品牌名称变化不影响本架构决策。

## 开发阶段标识

正式发布标识确认前，脚手架可以使用明确带有开发性质的临时标识。这些标识不得发布到 npm / PyPI，也不得当作稳定项目格式。GitHub 仓库名称已经确认为 `OldYannn/scope-text-workbench`。
