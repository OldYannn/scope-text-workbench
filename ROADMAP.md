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
- [ ] 使用非科研 diagnostic 操作验证进度、取消、异常恢复和可复现元数据
- [ ] 打包 Python sidecar，使用户无需安装系统 Python
- [ ] 在 Windows x64、macOS arm64 和 macOS x64 上验证安装包
- [ ] 用获批的 SCOPE 品牌资产替换开发模板图标
- [ ] 比较 License 方案并取得项目负责人确认

## Milestone 1 — 语料管理与文本清洗

Milestone 0 验收后开始。具体范围以 `PROJECT_BRIEF.md` 为准。

## 后续里程碑

后续将按照 `PROJECT_BRIEF.md` 依次推进中文分词与词频分析、共现分析、研究审计链、可选模型 Provider、实验性 AI 编码和首个 Public Alpha。

宣布任何 Milestone 完成前，都必须通过 `AGENTS.md` 规定的构建、测试、格式、文档、隐私和可复现性检查。
