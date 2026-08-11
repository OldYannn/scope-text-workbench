# ADR 0004：Windows-first 平台策略与分层验证

- 状态：Milestone 0 已接受并实现；Windows GUI E2E 已切换为 blocking embedded provider
- 日期：2026-08-11

## 项目负责人说明

- 为什么需要：Windows 预计是主要用户平台，但“Windows 安装包编译成功”只能证明文件生成了，不能证明真实应用可以交互，更不能代表普通用户的安装体验已经合格。
- 解决的问题：明确 Windows 与 macOS 的产品优先级，并把自动化逻辑、真实应用界面流程和人工用户体验拆成三种独立证据，避免以后笼统地写“Windows 已验证”。
- 主要风险：embedded WebDriver 具有强自动化能力，必须严格留在 Test Build；CI 仍无法看到 SmartScreen、字体、DPI 和整体使用感受。
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
2. **Windows GUI E2E**：在 Windows CI 中启动本次 Job 构建的真实 Tauri E2E Test Build，建立 WebDriver 会话并确认关键页面元素可见。
3. **Windows Project Owner UAT**：在真实 Windows 环境独立检查 NSIS 安装、首次启动、SmartScreen / Defender、窗口、DPI、字体和总体体验。

三层证据不得相互替代。真实 Windows UAT 暂不作为每次提交的阻塞条件，但属于重要 Milestone 和 Public Release 前的必要验收。

### GUI E2E 技术方案

Milestone 0 采用 WebdriverIO、`@wdio/tauri-service` 和 `tauri-plugin-wdio-webdriver` 的 embedded provider：

- 只在 Windows x64 CI Job 中运行一条串行 smoke spec；
- 先生成普通 Production bundle，再用显式 `e2e` Cargo feature 构建 Release 优化的 Test Build；
- Test Build 使用独立 `CARGO_TARGET_DIR`、`--no-bundle` 且不上传，不会覆盖或混入正式安装包；
- `tauri-plugin-wdio-webdriver` 是 optional dependency，只在 `#[cfg(feature = "e2e")]` 中注册；CI 会验证普通 feature graph 不含该插件；
- 通过稳定的 `data-testid` 观察公开界面，不读取 React 内部状态；
- npm 测试依赖与插件版本均锁定为 `1.3.0`；embedded 路径不启动外部 `tauri-driver` / MSEdgeDriver；
- 任何 Test Build、会话或元素断言失败都直接阻塞 Windows Job，不设 warning 放行。

当前 `@wdio/tauri-service 1.3.0` 在 Windows `onPrepare` 中仍会先执行 EdgeDriver 兼容性预检，必要时缓存或下载匹配文件；这是 service 尚未按 provider 短路的工具链行为。embedded 会话仍由 Test Build 内的 server 提供，不启动或调用外部 driver。后续升级 service 时应检查该冗余预检是否已移除。

原 external provider 依赖 EdgeDriver 注入调试端口，与 WebView2 Runtime 150 在 elevated host 中的有意安全强化冲突。这不再被定义为“等待 WebView2 上游修复”；embedded server 通过 Test Build 内部的 WebView 原生 API 工作，避开该外部调试端口。

2026-08-11 的 [GitHub Actions run 31454320984](https://github.com/OldYannn/scope-text-workbench/actions/runs/31454320984) 在 Windows x64 上完成了 Production 隔离检查、启动 Test Build、建立 embedded WebDriver 会话和关键元素断言。旧的 WebView2 150 日志匹配 wrapper 已删除，Windows GUI E2E 恢复为真正的 blocking test。

GUI E2E 完整通过后也只证明真实 Windows 应用的关键 WebView 流程，不证明安装器、操作系统安全提示、原生窗口或视觉质量。

## macOS 验证

macOS 保留现有自动化测试、arm64 与 x64 原生构建。embedded provider 未因此扩展到 macOS CI；macOS arm64 安装与首次启动继续按照 `docs/testing/gui-testing.md` 定义短 Test Flow，再进行最小必要的本机 Computer Use smoke test。

2026-08-11 已对提交 `871e73c` 的 macOS arm64 Production DMG 完成该 smoke：DMG 挂载、复制到 `/Applications`、首次启动和首页渲染均通过；未重复执行已由自动测试覆盖的诊断内部流程。

## 后果与复审条件

- Windows CI 时间会增加，且新增仅供测试使用的 Rust / Node 依赖；通过独立 lockfile、单用例和固定版本控制维护成本。
- Windows GUI E2E 因 Runner 或 WebView2 更新出现失败时，应保留日志并定位具体原因，不用 warning 放行或无限重试掩盖产品故障。
- 任何把 `e2e` feature 加入默认或正式发布构建的改动都是安全回归，必须阻塞。
- 只有真实流程扩展且已有稳定公开界面边界时，才增加新 E2E；内部算法继续优先使用更快的单元、契约和集成测试。
- 如果 GUI E2E 长期不稳定、维护成本明显超过发现问题的价值，或 Tauri 官方推荐路径改变，应复审本 ADR，但不因此自动更换桌面架构。
