# 长期开发流程

产品需求 → 方法/技术方案讨论 → 项目负责人确认 → Codex 实现 → 自动测试 → CI → Documentation Sync → Review / UAT → 下一切片。

每轮报告必须区分本地验证与当前 commit 的 CI 实际状态（PASS、RUNNING、FAILED、NOT RUN），并说明 Windows x64、macOS arm64 和 macOS x64 构建证据。研究算法先定义输入、输出、参数、默认值和固定 fixture，再进入 UI。

凡是研究功能依赖 package data 或 runtime resources，frozen-sidecar CI 必须实际调用该功能验证资源存在；仅通过 source-level tests 不足以证明 production artifact 可用。核心 feature initialization 失败不得在 GUI 中 silent swallow，必须提供可理解的错误、重试入口，并禁用依赖该功能的操作。
