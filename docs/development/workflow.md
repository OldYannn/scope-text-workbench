# 长期开发流程

产品需求 → 方法/技术方案讨论 → 项目负责人确认 → Codex 实现 → 自动测试 → CI → Documentation Sync → Review / UAT → 下一切片。

每轮报告必须区分本地验证与当前 commit 的 CI 实际状态（PASS、RUNNING、FAILED、NOT RUN），并说明 Windows x64、macOS arm64 和 macOS x64 构建证据。研究算法先定义输入、输出、参数、默认值和固定 fixture，再进入 UI。

凡是研究功能依赖 package data 或 runtime resources，frozen-sidecar CI 必须实际调用该功能验证资源存在；仅通过 source-level tests 不足以证明 production artifact 可用。核心 feature initialization 失败不得在 GUI 中 silent swallow，必须提供可理解的错误、重试入口，并禁用依赖该功能的操作。

任何面向用户的 XLSX 产物都必须由成熟 writer 生成，并由 reader 在自动测试中 round-trip 重新打开、核对 sheet、表头和固定数据；仅检查 ZIP magic 或文件存在不构成有效验证。Corpus-level 确定性预处理必须提供批量执行；任何长任务都要在当前工作区显示进度、取消和部分失败摘要。

桌面交互新增或修改时，优先复用已建立的 Button、Tooltip、Popover、Drawer 和 Notification primitives。辅助工具不得 reflow 主研究工作区；长解释使用 Popover / Dialog，独立工具使用 Drawer / Dialog。任何会改变研究配置的操作必须是明确、可访问的控件，文本、chip 或词语本身不得承担隐式修改行为。组件测试至少覆盖 keyboard / Escape 关闭、明确操作与主工作区保持可见；Windows GUI E2E 应覆盖关键弹层的打开、关闭与主结果不消失。
