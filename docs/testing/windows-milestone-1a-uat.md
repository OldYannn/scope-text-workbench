# Windows 11 x64 项目负责人 UAT：Milestone 1A

状态：**PASS with minor UX findings**（核心安装、项目、中文路径、TXT 导入、预览、重开和常规尺寸布局均通过）

本轮记录的三个非架构问题及 resolution：

1. Open Project 引导问题：已在进入选择器前显示“请选择 SCOPE 项目文件夹，例如‘基层治理访谈’；有效项目文件夹中包含 `project.json`”，选择 `corpus` 等内部目录时会明确提示上一级项目名称；无效目录会显示可理解的错误。
2. 极窄窗口重叠：桌面窗口最小尺寸固定为 760 × 620，内容容器同步设置最小宽度，避免在可缩放范围内重叠；未改变整体 UI 设计。
3. Windows Python sidecar Console 可见：根因为 Rust 使用普通 `Command::spawn()` 启动 packaged sidecar，Windows 控制台子系统创建了可见 Console；已在 Windows spawn 时增加 `CREATE_NO_WINDOW`（仅 Windows），不改变 stdin/stdout/stderr 管道或 Engine 协议。

Console 黑窗问题必须在下一次外部研究者测试前由 Windows x64 安装包复验。

请使用本轮 CI 生成的 Windows x64 安装包，在真实 Windows 11 电脑上完成以下流程。该 UAT 与自动化 GUI E2E 分开记录。

1. 创建名为“中文访谈项目”的项目，并把它保存在含中文名称的文件夹中。应进入项目主页并看到语料数量为 0。
2. 一次选择一个或多个 UTF-8 中文 TXT。应在语料列表看到中文文件名、字符数和“已导入”状态。
3. 点击一篇语料。应在右侧看到完整中文原文，没有乱码或截断。
4. 点击“关闭项目”，再点击“打开已有项目”并选择刚才的项目文件夹。应恢复相同文档列表，且仍能查看原文。
5. 分别在 Windows 显示缩放 100% 和 150% 下查看主窗口。按钮、文件名和预览区不应被遮挡。

请反馈：是否全部通过；如失败，请注明步骤、屏幕缩放比例、文件编码，并附截图或错误提示。
