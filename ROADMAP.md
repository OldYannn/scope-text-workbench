# SCOPE 开发路线图

SCOPE 当前处于 Pre-alpha 阶段。在关键技术风险得到验证前，路线图不承诺具体发布日期。

## Milestone 0 — 仓库与技术基础

- [x] 确认桌面应用架构方向
- [x] 建立 GitHub 仓库和项目核心文档
- [x] 记录桌面壳与 Python sidecar 的架构决策
- [x] 定义首版带版本号的 sidecar 通信协议
- [x] 建立最小 React / Tauri 桌面壳
- [x] 建立 Python 分析引擎开发包和协议契约测试
- [x] 建立首版 CI、Lint、Format 和构建检查
- [x] 使用非科研 diagnostic 操作验证进度、取消、异常恢复和可复现元数据
- [x] 打包 Python sidecar，使用户无需安装系统 Python
- [x] 在 Windows x64 CI 中通过真实 Tauri Test Build 的 blocking embedded GUI E2E
- [ ] 在 Windows x64、macOS arm64 和 macOS x64 上验证安装包
- [ ] 在真实 Windows x64 环境完成安装、首次启动、安全提示、DPI、字体和体验 UAT
- [x] 在 macOS arm64 完成安装与首次启动的最小 Computer Use smoke test
- [ ] 用获批的 SCOPE 品牌资产替换开发模板图标
- [x] 由项目负责人确认采用 Apache License 2.0

### Milestone 0 Gate

**READY FOR MILESTONE 1**

2026-08-22，提交 `16c63bf` 的现有完整 CI 已全部通过：Automated Test、Windows x64 Build、Windows GUI E2E、macOS arm64 Build 和 macOS x64 Build。验证记录见 [GitHub Actions](https://github.com/OldYannn/scope-text-workbench/actions/runs/32512116725)。

真实 Windows x64 项目负责人 UAT、正式品牌图标、发布级签名与公证继续保留为发布准备事项，但不阻塞 Milestone 1 产品功能开发。Milestone 0 不再为清空非阻塞 checkbox 扩大基础设施范围。

## Milestone 1 — 语料管理与文本清洗

Milestone 0 Gate 通过后开始。具体范围以 `PROJECT_BRIEF.md` 为准。

### Milestone 1A — 项目创建 + TXT 导入 + 语料预览

- [x] 创建和打开可整体迁移的本地项目目录
- [x] 保存项目标识、名称、创建时间、软件版本和格式版本
- [x] 导入单个或多个 UTF-8 / UTF-8 BOM TXT
- [x] 保存原始字节副本、预览文本、来源信息和稳定输入哈希
- [x] 显示项目概览、语料列表、导入状态和文本预览
- [x] 关闭并重新打开项目后恢复语料
- [x] 保存最小真实导入审计记录并明确 `network_used: false`
- [x] 增加固定 fixture、协议测试、React 测试和 Windows GUI E2E 主流程
- [ ] 完成独立 Windows 11 x64 项目负责人 UAT

CSV、XLSX、DOCX、文本清洗和其他分析功能留给后续切片。

## Milestone 1B — 文本清洗

- [x] 保留不可变的原始 `text` 与派生 `analysis_text`
- [x] 空白、换行、URL、HTML 和标点规则可复现保存
- [x] 保存清洗配置、输入哈希、实现版本和审计事件

### Milestone 1B Gate

Milestone 1B 已完成，分词只允许使用明确保存的 `analysis_text`；未生成分析文本的文档会得到明确提示，不会静默回退到原始文本。

## Milestone 2A — 中文分词基础能力

- [x] 固定使用 `jieba==0.42.1`，标准精确模式（accurate/default）
- [x] HMM 默认开启，并在 manifest 中记录开关
- [x] 支持 UTF-8 jieba 标准用户词典，复制到项目 `dictionaries/` 目录并记录 SHA-256
- [x] 保存结构化 token sequence，不把 token 拼接为不可逆字符串
- [x] 保存输入 `analysis_text` hash、引擎/版本、模式、词典、执行时间和实现版本
- [x] 查看 token、导入词典、重新运行，关闭并重新打开项目后恢复结果
- [x] 固定中文 fixtures 覆盖普通句子、标点、空文本、中英文、数字、HMM 和词典变化
- [x] 不修改原始语料或分析文本；不引入远程模型

### Milestone 2A Gate

分词能力完成后，下一阶段进入“停用词 / 词频 / TF-IDF 基础统计闭环”。停用词仍是独立阶段，默认不自动删除；TF-IDF 将基于当前用户语料库自行计算 document frequency / inverse document frequency，不把 jieba 内置关键词提取作为默认科研方法。

## 后续里程碑

### Milestone 2B — Stopword Profiles + Frequency Analysis

- [x] 版本化停用词 profile、exact-token filter、custom additions/exclusions 和 resolved snapshot
- [x] TF / DF / RF10K、document coverage、未分词文档报告与 Frequency Manifest
- [x] CSV（UTF-8 BOM）与 XLSX 双 sheet 导出基础能力
- [x] 透明的停用词优化候选逻辑（仅供人工判断）
- [ ] 完成真实 GUI 导出按钮与项目负责人 UAT

文本类型扩展 profile 仅完成数据模型，待方法审查后再发布词项。

### Milestone 2B.1 — Stopword Product Closure & Curation

- [x] 四套 goto456/stopwords 完整 upstream snapshot、normalized runtime profile 和 hash/count metadata
- [x] deterministic provenance generator 与 2312 行 token-level matrix
- [x] SCOPE v1 标记为 draft，duplicate detection 与 lifecycle changelog
- [x] GUI profile switching、custom additions/exclusions、resolved set viewer 和 UTF-8 TXT import
- [x] 可选优化助手、候选操作、排序、Top N 和 raw/eligible/effective 计数
- [x] GUI CSV/XLSX 文件保存导出
- [ ] Windows/macOS 中文路径 UAT 与 CI 构建验证

后续将按照 `PROJECT_BRIEF.md` 依次推进中文分词与词频分析、共现分析、研究审计链、可选模型 Provider、实验性 AI 编码和首个 Public Alpha。

宣布任何 Milestone 完成前，都必须通过 `AGENTS.md` 规定的构建、测试、格式、文档、隐私和可复现性检查。

当前平台策略为 **Windows-first，cross-platform supported**。正式目标仅包括 Windows x64、macOS arm64 和 macOS x64；Milestone 0 暂不增加 Windows ARM64 或 Linux。Windows GUI E2E 通过不等于真实 Windows UAT 通过，三层证据必须分别记录。
