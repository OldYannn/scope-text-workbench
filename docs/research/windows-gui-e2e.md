# Windows GUI E2E 最小可行性评估

> 调研日期：2026-08-10  
> 适用阶段：Milestone 0  
> 结论：可在现有 Windows x64 GitHub Actions Job 中加入一条真实 Tauri 应用的短 GUI smoke test（冒烟测试）。建议采用 WebdriverIO、`@wdio/tauri-service` 和外部 `tauri-driver`，暂不把测试插件嵌入 SCOPE。

## 1. 结论摘要

当前方案技术上可行，且成本与 Milestone 0 相称：

- Tauri 官方文档明确给出了在 GitHub Actions `windows-latest` 上直接运行 WebDriver 测试的示例；Windows 不需要 Linux 使用的 Xvfb 虚拟显示器。[Tauri CI 文档](https://v2.tauri.app/develop/tests/webdriver/ci/)
- Tauri 目前推荐使用 WebdriverIO 与 `@wdio/tauri-service`。Windows 可通过外部 `tauri-driver` 驱动真实 WebView2 应用，service 可以管理与 WebView2 匹配的 Edge WebDriver。[Tauri WebDriver 概览](https://v2.tauri.app/develop/tests/webdriver/)
- SCOPE 当前只需要点击、读取界面文字和等待状态变化，不需要后端命令模拟或日志注入。因此最小实现无需修改 Rust/React 产品代码，也无需加入 `tauri-plugin-wdio` 或内嵌 WebDriver server。
- 该测试能证明“Windows CI 中真实 Tauri 应用的关键 WebView 流程可运行”，但不能证明 NSIS 安装、SmartScreen、Defender、系统窗口、DPI、字体或真实用户体验。这些仍属于 Windows Project Owner UAT。

## 2. Windows 支持状态与运行环境

### 2.1 Tauri 与 WebdriverIO 支持

Tauri 2 当前推荐的路径是 WebdriverIO 加 `@wdio/tauri-service`。Windows 支持三种 driver provider：

| Provider     | Windows 支持 | 本项目当前评价                                                  |
| ------------ | -----------: | --------------------------------------------------------------- |
| `external`   |           是 | 推荐；使用独立 `tauri-driver` 和 Edge WebDriver，不改变产品代码 |
| `embedded`   |           是 | 暂不采用；需要在测试构建中加入内嵌 WebDriver 插件               |
| `crabnebula` |           是 | 暂无必要；引入额外平台和供应商                                  |

WebdriverIO 文档已将旧名称 `official` 标记为 `external` 的待移除别名，因此新配置应使用 `driverProvider: "external"`，同时在锁定依赖后以实际版本验证配置。[WebdriverIO Tauri service 配置](https://webdriver.io/docs/desktop-testing/tauri/configuration/)

`@wdio/tauri-service` 由 WebdriverIO 项目维护，Tauri 官方文档推荐使用，但 WebdriverIO 页面仍将它标为 third-party package（第三方包）。这意味着可以采用，但应固定 npm 版本并保留一次小范围集成验证，不宜一开始建立庞大的 E2E 测试体系。[WebdriverIO Tauri service](https://webdriver.io/docs/desktop-testing/tauri/)

### 2.2 GitHub-hosted Windows Runner

Tauri 官方 CI 示例在 `windows-latest` 上直接执行 WebdriverIO，不要求额外的无头模式开关，也不需要 Xvfb。这里的“CI 自动运行”不等于用户能看到桌面，而是 Runner 提供了足以启动并驱动 GUI 应用的 Windows 会话。[Tauri CI 文档](https://v2.tauri.app/develop/tests/webdriver/ci/)

当前 GitHub Windows 2025 Runner 镜像包含 Edge、相同版本的 Edge Driver、Rust、Node.js 和 Visual Studio 工具链。不过 Runner 镜像会更新，不能把当前预装版本当作长期固定接口；测试仍应让 service 检查或下载匹配的 Edge Driver。[GitHub Windows 2025 镜像清单](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)

## 3. 所需组件

### 3.1 Windows WebDriver 链路

最小链路如下：

```text
WebdriverIO smoke spec
        ↓
@wdio/tauri-service
        ↓
tauri-driver（独立进程）
        ↓
msedgedriver.exe
        ↓
SCOPE 的 WebView2 界面
```

Microsoft 要求 Edge WebDriver 的版本与应用使用的 WebView2 Runtime 匹配；不匹配可能导致连接失败或停滞。[Microsoft WebView2 WebDriver 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver)

建议：

- CI 显式执行 `cargo install tauri-driver --locked`，让安装步骤和失败日志可审查；
- `@wdio/tauri-service` 开启 `autoDownloadEdgeDriver: true`，处理 Runner 更新造成的版本变化；
- 测试指向本次 Job 刚构建的真实 Release `.exe`；
- `maxInstances: 1`，只运行一条串行 smoke spec，避免多个应用和 sidecar 竞争端口或进程状态。

### 3.2 最小项目依赖

核心运行组件如下，并通过 `tests/e2e/package-lock.json` 固定完整解析结果：

- `@wdio/cli`；
- `@wdio/local-runner`；
- `@wdio/mocha-framework`；
- `@wdio/tauri-service`。

实现中还需要 `@wdio/globals`、`@wdio/spec-reporter` 和 `webdriverio` 提供测试 API、输出与显式运行时版本；它们同样只存在于隔离的测试目录。

测试使用普通 JavaScript 配置和 spec 即可，不必为了这一条测试再增加 TypeScript 运行器、视觉回归服务、录像服务、Selenium Server 或页面对象框架。WebdriverIO 的 Local Runner 与 Mocha adapter 属于其官方测试运行方式。[WebdriverIO Runner](https://webdriver.io/docs/runner/)、[WebdriverIO Frameworks](https://webdriver.io/docs/frameworks/)

## 4. 建议的最小配置与 CI 流程

配置形态如下，路径应以 SCOPE 实际 Windows Release 可执行文件为准：

```js
export const config = {
  runner: "local",
  specs: ["./tests/e2e/windows-smoke.spec.js"],
  maxInstances: 1,
  framework: "mocha",
  services: [
    [
      "tauri",
      {
        appBinaryPath:
          "./apps/desktop/src-tauri/target/release/scope-desktop-dev.exe",
        driverProvider: "external",
        autoDownloadEdgeDriver: true,
      },
    ],
  ],
  capabilities: [{ browserName: "tauri" }],
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  mochaOpts: { timeout: 60_000 },
};
```

实际实现时先以锁定版本的配置 Schema 为准运行一次；WebdriverIO 当前文档同时存在新旧配置示例，不应仅凭片段假定字段兼容。

建议在现有 Windows x64 Job 中按以下顺序执行：

1. 完成既有 Rust、Python、React、协议与 sidecar 自动化测试；
2. 冻结 Windows x64 sidecar；
3. 构建真实 Tauri Release 可执行文件，并确认 sidecar 位于 Release 运行时所需位置；
4. 安装 `tauri-driver`；
5. 执行 `npx wdio run wdio.conf.js`；
6. 失败时保留 WebdriverIO 日志；只有日志不足以定位界面问题时再增加截图；
7. GUI smoke 通过后再生成或保留安装产物。

Tauri 官方 CI 示例同样建议先运行 Rust 测试，再执行 WebDriver，以避免用 GUI 测试重复发现基础代码已经损坏。[Tauri CI 文档](https://v2.tauri.app/develop/tests/webdriver/ci/)

## 5. 最小 smoke test 范围

只保留一条串行用户流程：

1. 应用进程成功启动；
2. SCOPE 诊断页关键标题和“运行诊断”按钮出现；
3. 点击开始，等待进度状态发生变化；
4. 点击取消，确认取消终态；
5. 再次点击开始；
6. 等待执行完成；
7. 确认可复现清单显示。

界面元素应使用稳定、语义明确的 `data-testid`，不要依赖中文文字、CSS 层级或坐标。测试只等待可观察状态，不使用大段固定 `pause`。

此测试不增加视觉截图比对，不探索额外页面，不重复检查 NDJSON 消息细节，也不重新断言已经由 Python/Rust/React 测试覆盖的内部算法。

## 6. 能证明什么，不能证明什么

| 证据层级                  | 本方案覆盖                                    | 不覆盖                                                               |
| ------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| Windows Automated Test    | Rust、Python、React、协议、sidecar、清单内容  | GUI 真实交互                                                         |
| Windows GUI E2E           | 真实 Tauri `.exe` 启动与一条 WebView 关键流程 | 安装器、系统安全提示、原生窗口与视觉质量                             |
| Windows Project Owner UAT | 不由 CI 执行                                  | NSIS 安装、首次启动、SmartScreen/Defender、DPI、字体、窗口和总体体验 |

Microsoft 明确说明 Edge WebDriver 控制的是 WebView2 内容，不负责应用外部的原生 GUI；涉及原生界面时需要其他原生 UI 自动化方式或人工验证。[Microsoft WebView2 WebDriver 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver)

因此，Windows GUI E2E 通过不能写成“Windows 用户体验已验证”，只能写成“Windows CI 真实应用关键 WebView 流程通过”。

## 7. macOS 的处理

官方外部 `tauri-driver` 不能直接驱动 macOS 的 WKWebView，因为 macOS 没有对应的桌面 WebDriver 工具。[Tauri WebDriver 概览](https://v2.tauri.app/develop/tests/webdriver/)

2026 年当前的 WebdriverIO Tauri service 可以通过 `embedded` provider 和 `tauri-plugin-wdio-webdriver` 支持 macOS，但这会在测试构建中嵌入 HTTP WebDriver server。官方要求这类插件只用于测试，并通过 debug 条件或 Cargo feature 与生产构建隔离。[WebdriverIO Plugin Setup](https://webdriver.io/docs/desktop-testing/tauri/plugin-setup/)

Milestone 0 暂不为了统一平台测试而引入该插件。macOS 继续采用：

- 现有自动化测试和本机构建；
- 按 `docs/testing/gui-testing.md` 预先定义 Test Flow；
- 一次最小必要的 macOS arm64 Computer Use 安装／首次启动 smoke test。

## 8. 风险与控制措施

### 8.1 稳定性

- `windows-latest`、Edge 和 WebView2 会更新，可能产生偶发的 driver mismatch；由 service 自动匹配，失败保留日志，必要时再评估把 CI 标签固定到具体 Windows 镜像。
- WebDriver 启动与 sidecar 首次启动存在时序波动；使用条件等待和有限超时，不用无限重试掩盖真实故障。
- 当前只维护一条 smoke spec。只有当真实产品流程增加后，才按用户路径增加用例。

### 8.2 安全与供应链

- WebDriver Job 会运行仓库代码并自动下载／启动工具，不向该 Job 注入项目 Secret；`GITHUB_TOKEN` 使用最小只读权限。
- 不使用 `pull_request_target` 检出并运行不受信任的 PR 代码。GitHub 明确警告这会暴露具有权限的工作流并带来仓库接管风险。[GitHub Actions 安全使用参考](https://docs.github.com/en/actions/reference/security/secure-use)
- npm 依赖通过 lockfile 固定；Cargo 安装使用 `--locked`；测试失败日志不得包含 Secret 或用户语料。
- 当前方案不加入 `tauri-plugin-wdio`、`withGlobalTauri`、额外 Tauri capability 或 embedded WebDriver server，避免为了单条 GUI 测试扩大应用权限面。

## 9. Milestone 0 建议

**建议现在加入。** 原因是它补上了“Windows Build 成功”和“真实 Windows 应用流程可交互”之间的证据缺口，同时改动范围可控制在：

- 一组隔离并锁定版本的 Node 测试依赖；
- 一份 WebdriverIO 配置；
- 一条 smoke spec；
- Windows x64 CI Job 中少量步骤；
- 必要的稳定 `data-testid`。

首轮 CI 成功前应把该能力标为“试运行”，确认 Runner、Edge Driver、Release sidecar 路径和取消流程均稳定后，再将它设为必需检查。它不改变 Tauri + React + Python sidecar 架构，也不替代真实 Windows UAT。

## 项目负责人说明

这套测试相当于让 GitHub 上的一台临时 Windows 电脑自动打开 SCOPE，完成一遍最短的诊断流程。它比“安装包编译成功”更接近用户实际使用，因此值得在 Milestone 0 加入。

它仍看不到 SmartScreen 是否吓到用户、字体是否舒服、窗口在高分屏上是否合适，也不能真的评价安装体验。这些问题必须以后在一台真实 Windows 电脑上由项目负责人或测试者验收。

当前不需要项目负责人决定新的架构或购买服务。需要注意的唯一边界是：首轮 GUI E2E 先作为试运行检查；稳定后再把它变成每次合并都必须通过的门槛。
