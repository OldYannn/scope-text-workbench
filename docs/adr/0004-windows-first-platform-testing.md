# ADR 0004：Windows-first 平台策略与分层验证

- 状态：Milestone 0 已接受，Windows GUI E2E 待 CI 实证
- 日期：2026-08-10

## 项目负责人说明

- 为什么需要：Windows 预计是主要用户平台，但“Windows 安装包编译成功”只能证明文件生成了，不能证明真实应用可以交互，更不能代表普通用户的安装体验已经合格。
- 解决的问题：明确 Windows 与 macOS 的产品优先级，并把自动化逻辑、真实应用界面流程和人工用户体验拆成三种独立证据，避免以后笼统地写“Windows 已验证”。
- 主要风险：GitHub 的 Windows、Edge 和 WebView2 会更新，GUI E2E 可能出现环境波动；CI 仍无法看到 SmartScreen、字体、DPI 和整体使用感受。
- 需要项目负责人决策：当前不需要更换架构或购买服务。重要 Milestone 和 Public Release 前，需要项目负责人安排一次真实 Windows UAT，并决定正式代码签名方案。

## 背景

SCOPE 正式支持 Windows 和 macOS。当前主要开发环境是 macOS，但未来主要目标用户预计以 Windows 用户为主。已有 CI 能在 Windows x64、macOS arm64 和 macOS x64 原生构建冻结 sidecar 和桌面安装产物；其中 Windows 的构建成功尚不足以证明真实应用关键流程可操作。

Tauri 官方支持在 Windows CI 中通过 WebDriver 驱动 WebView2。SCOPE 的 Milestone 0 diagnostic tracer bullet 已经提供一条足够短、不会读取研究语料的真实流程，适合用来弥补这一证据缺口。

## 决策

### 产品平台策略

采用 **Windows-first，cross-platform supported（Windows 优先、跨平台正式支持）**：

- Windows x64 是第一目标平台和最终用户体验的 Reference Platform（参考平台）；
- macOS arm64 与 macOS x64 是正式支持平台，macOS 继续作为当前主要开发环境；
- 核心功能、核心研究流程、项目文件和数据格式、分析结果、参数与可复现记录必须跨平台一致；
- 主要视觉语言保持一致，窗口、文件选择器、快捷键、系统字体、安装流程与安全提示遵循各平台惯例；
- 低风险 UX 冲突无法同时优化时，在不破坏 macOS 正常使用的前提下优先保证 Windows 体验；
- 当前不增加 Windows ARM64 或 Linux。

### Windows 验证层级

1. **Windows Automated Test**：覆盖 Rust、Python、React、NDJSON 协议、sidecar 和可复现清单。
2. **Windows GUI E2E**：在 Windows CI 中启动本次 Job 构建的真实 Tauri Release `.exe`，执行一条开始、进度、取消、再次运行、完成和显示清单的 smoke test。
3. **Windows Project Owner UAT**：在真实 Windows 环境独立检查 NSIS 安装、首次启动、SmartScreen / Defender、窗口、DPI、字体和总体体验。

三层证据不得相互替代。真实 Windows UAT 暂不作为每次提交的阻塞条件，但属于重要 Milestone 和 Public Release 前的必要验收。

### GUI E2E 技术方案

Milestone 0 采用 WebdriverIO、`@wdio/tauri-service` 和外部 `tauri-driver`：

- 只在 Windows x64 CI Job 中运行一条串行 smoke spec；
- 测试本次 Job 刚生成的普通 Release 应用，不创建特殊产品构建；
- 通过稳定的 `data-testid` 观察公开界面，不读取 React 内部状态；
- 不加入 embedded WebDriver server、测试专用 Tauri plugin、额外 capability 或产品权限；
- npm 测试依赖与版本锁定在 `tests/e2e`，`tauri-driver` 用精确版本和 Cargo lock 安装；
- 让 service 匹配 WebView2 的 Edge Driver，以降低 Runner 更新造成的版本不一致风险。
- 每次测试使用独立、可写的临时 WebView2 user data folder，避免与普通用户数据混用，也减少 CI 临时目录布局造成的会话启动问题。

首轮 Windows CI 通过前，该检查视为试运行；稳定后保留为 CI 的正常阻塞步骤。它只证明真实 Windows 应用的关键 WebView 流程，不证明安装器、操作系统安全提示、原生窗口或视觉质量。

## macOS 验证

macOS 保留现有自动化测试、arm64 与 x64 原生构建。Milestone 0 不为追求表面一致而嵌入测试 WebDriver server；macOS arm64 安装与首次启动继续按照 `docs/testing/gui-testing.md` 定义短 Test Flow，再进行最小必要的本机 Computer Use smoke test。

## 后果与复审条件

- Windows CI 时间会增加，且新增一组仅供测试使用的 Node 依赖；通过独立 lockfile、单用例和固定版本控制维护成本。
- Windows GUI E2E 因 Runner 或 WebView2 更新出现偶发失败时，应先检查驱动匹配与日志，不用无限重试掩盖产品故障。
- 只有真实流程扩展且已有稳定公开界面边界时，才增加新 E2E；内部算法继续优先使用更快的单元、契约和集成测试。
- 如果 GUI E2E 长期不稳定、维护成本明显超过发现问题的价值，或 Tauri 官方推荐路径改变，应复审本 ADR，但不因此自动更换桌面架构。
