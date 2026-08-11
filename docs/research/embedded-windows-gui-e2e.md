# Windows GUI E2E embedded provider 技术 Spike 调研

> 调研日期：2026-08-11  
> 适用阶段：Milestone 0  
> 调研范围：只评估把现有 Windows GUI E2E 从外部 `tauri-driver` / MSEdgeDriver 切换到 `tauri-plugin-wdio-webdriver` 的 `embedded` provider，不涉及产品功能或平台扩张。

## 1. 结论摘要

**建议立即做一条严格受控的 embedded provider Spike，并以 GitHub-hosted Windows Runner 的实际结果决定是否正式切换。** 官方资料和当前锁定依赖均表明，这条路线与现有架构兼容，预计改动量较小：

- Tauri 当前推荐 WebdriverIO 与 `@wdio/tauri-service`；该 service 的默认路线是在应用内运行 embedded WebDriver，不依赖外部 `tauri-driver` 或 MSEdgeDriver，支持 Windows、macOS 和 Linux。[Tauri WebDriver 概览](https://v2.tauri.app/develop/tests/webdriver/)
- WebdriverIO 的官方配置把 `embedded` 列为三平台可用且不需要外部 driver 的推荐简化方案；默认端口是 `4445`，Windows 上应显式写 `driverProvider: "embedded"`，避免依赖自动探测规则。[WebdriverIO Tauri 配置](https://webdriver.io/docs/desktop-testing/tauri/configuration/)
- 截至调研日，SCOPE 锁定的 `@wdio/tauri-service` 是 `1.3.0`；同一官方仓库中的 `tauri-plugin-wdio-webdriver` 当前也是 `1.3.0`，要求 Tauri `2.10.0` 兼容范围和 Rust `1.77`。SCOPE 当前 Cargo lock 中的 Tauri 为 `2.11.5`，版本范围相容。[service package.json](https://github.com/webdriverio/desktop-mobile/blob/main/packages/tauri-service/package.json)、[plugin Cargo.toml](https://github.com/webdriverio/desktop-mobile/blob/main/packages/tauri-plugin-webdriver/Cargo.toml)
- embedded server 直接使用 WebView2 原生 API，不通过 WebView2 150 已禁止的 elevated host 环境变量注入调试端口，因此技术路径绕开了当前 official/external provider 的阻塞点，而不是等待 Runtime 回退安全策略。[wry #1782](https://github.com/tauri-apps/wry/issues/1782)、[Microsoft WebView2Feedback #5645](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645)

这仍是“高可行性、待 CI 实证”的结论。只有 Windows Runner 真正建立 WebDriver session、找到 SCOPE 关键元素并完成最短 smoke 后，才能把 `Windows GUI E2E` 状态改为 `PASS` 和 blocking test。

## 2. 当前基线

Spike 开始前的提交 `ad342f2` 中，`tests/e2e/wdio.conf.mjs` 明确配置：

```js
driverProvider: "external";
```

CI 还会执行：

```text
cargo install tauri-driver --version 2.0.6 --locked
```

因此当前链路实际是：

```text
WebdriverIO → @wdio/tauri-service → tauri-driver → MSEdgeDriver → WebView2
```

`official` 是 `external` 的旧别名；WebdriverIO 源码已把 `official` 标记为待移除的兼容名称。SCOPE 当前使用规范名称 `external`，但两者都是同一类外部 driver 路线。[WebdriverIO Tauri service](https://webdriver.io/docs/wdio-tauri-service/)

WebView2 Runtime 150 在 elevated/admin host 上忽略 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 等调试参数是有意的安全强化。GitHub-hosted Windows Runner 以管理员权限运行，外部 EdgeDriver 因而无法建立 CDP session；这不应再记录为“等待 WebView2 上游修复”。[wry #1782](https://github.com/tauri-apps/wry/issues/1782)

## 3. embedded provider 的实际工作方式

最小链路变为：

```text
WebdriverIO smoke spec
        ↓
@wdio/tauri-service
        ↓ 启动 Test Build，并设置 TAURI_WEBDRIVER_PORT
SCOPE Test Build 内的 tauri-plugin-wdio-webdriver
        ↓
WebView2 原生 API
```

service 会启动指定的 SCOPE 可执行文件、设置 `TAURI_WEBDRIVER_PORT`、轮询本机 `/status`，然后直接连接应用内的 W3C WebDriver HTTP server；测试结束时负责终止应用。它不会启动 `tauri-driver` 或下载 MSEdgeDriver。[WebdriverIO Plugin Setup](https://webdriver.io/docs/desktop-testing/tauri/plugin-setup/)、[embeddedProvider.ts](https://github.com/webdriverio/desktop-mobile/blob/main/packages/tauri-service/src/embeddedProvider.ts)

插件默认监听 `127.0.0.1:4445`。桌面平台只绑定 loopback，不对局域网或互联网开放；但它仍然提供点击、输入、脚本执行等强自动化能力，所以只能存在于明确的 Test Build。[plugin server 源码](https://github.com/webdriverio/desktop-mobile/blob/main/packages/tauri-plugin-webdriver/src/server/mod.rs)

本次最短 smoke 只需基本 WebDriver 元素查找与显示判断，不需要 `browser.tauri.execute()`、命令 mock 或前后端日志桥接。因此不需要再引入另一套 `tauri-plugin-wdio`、`@wdio/tauri-plugin`、`withGlobalTauri` 或 `wdio:*` IPC 权限；只需 Rust-only 的 `tauri-plugin-wdio-webdriver`。官方文档也区分了基本元素操作与高级 Tauri 集成功能。[WebdriverIO Plugin Setup](https://webdriver.io/docs/desktop-testing/tauri/plugin-setup/)

## 4. 最小 test-only 隔离方案

不建议只用 `debug_assertions`，因为本项目希望测试接近正式 Release 优化方式。建议使用一个默认关闭的 Cargo feature，例如 `e2e`：

```toml
[features]
e2e = ["dep:tauri-plugin-wdio-webdriver"]

[dependencies]
tauri-plugin-wdio-webdriver = { version = "1.3.0", optional = true }
```

Rust 入口只在该 feature 启用时注册插件：

```rust
let builder = tauri::Builder::default();

#[cfg(feature = "e2e")]
let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
```

普通 Production Build 不传 feature，因此 Cargo 不会把 optional dependency 链接进应用，Rust 也不会注册 HTTP server。官方插件 README 明确警告不得把它放入生产构建，并给出了 optional feature 方案。[tauri-plugin-wdio-webdriver README](https://github.com/webdriverio/desktop-mobile/tree/main/packages/tauri-plugin-webdriver)

为避免测试权限进入生产配置，可再使用一份很小的 Tauri E2E 配置覆盖文件，只在 Test Build 命令中通过 `--config` 合并，加入 `wdio-webdriver:default` capability。这个 permission set 当前不授予 IPC command，但官方仍建议列出它以加载插件 ACL manifest。[WebdriverIO Plugin Setup](https://webdriver.io/docs/desktop-testing/tauri/plugin-setup/)

Tauri 官方支持用 `--config` 合并额外配置，明确把不同 build flavor 作为适用场景。[Tauri Configuration Files](https://v2.tauri.app/develop/configuration-files/)、[Tauri CLI reference](https://v2.tauri.app/reference/cli/)

建议把 Test Build 放到单独的 Cargo target directory，防止它覆盖普通 Release 可执行文件或污染安装包目录：

```powershell
$env:CARGO_TARGET_DIR = "$PWD\apps\desktop\src-tauri\target\e2e"
npm run tauri -- build --no-bundle --features e2e --config src-tauri/tauri.e2e.conf.json
$env:SCOPE_E2E_APP = "$env:CARGO_TARGET_DIR\release\scope-desktop-dev.exe"
npm test --prefix tests/e2e
```

这里的路径需要以仓库实际 npm workspace 工作目录做一次 CI 校准；关键约束是：

1. Production bundle 先按原命令构建，默认 feature 中没有 WebDriver；
2. Test Build 显式启用 `e2e`，使用独立 target directory 且 `--no-bundle`；
3. WebdriverIO 只指向 Test Build；
4. CI 通过 `cargo tree` 或等价检查证明普通 feature graph 不含 `tauri-plugin-wdio-webdriver`，而 Test Build graph 包含它；
5. 正式安装包只上传 Production bundle，不上传 Test Build。

这种隔离比“同一 Release 二进制运行时看环境变量决定是否启动 server”更强：普通构建根本没有插件代码，环境变量也无法激活不存在的能力。

## 5. WebdriverIO 与 Windows CI 最小改动

配置只需保留真实可执行文件路径并改 provider：

```js
services: [
  [
    "tauri",
    {
      appBinaryPath,
      driverProvider: "embedded",
      embeddedPort: 4445,
      startTimeout: 60_000,
      logLevel: "info",
    },
  ],
];
```

应删除只对 external provider 有意义的：

- `autoInstallTauriDriver`；
- `autoDownloadEdgeDriver`；
- `webviewOptions.userDataFolder`；
- CI 中的 `cargo install tauri-driver`；
- 识别 WebView2 150 / `DevToolsActivePort` 并 warning 放行的 wrapper 逻辑。

官方说明 embedded 的默认启动超时是 60 秒，尤其考虑 Windows CI 启动较慢；默认端口 4445，每个 worker 可递增端口。本项目保持 `maxInstances: 1` 即可，不需要额外并行管理。[WebdriverIO Tauri 配置](https://webdriver.io/docs/desktop-testing/tauri/configuration/)

Spike 的最小断言应只有：

1. Test Build 进程被 service 启动；
2. WebdriverIO 成功建立 session；
3. 找到一个稳定的 SCOPE `data-testid` 元素；
4. 断言该元素可见。

第一轮不必重复执行诊断进度、取消、异常恢复和清单的内部逻辑。这些已有自动化测试；待 embedded 会话稳定后，再决定是否保留现有较长 Windows 用户流程。

## 6. 通过与失败判定

如果 GitHub Windows Runner 连续实际运行成功，建议：

- Windows GUI E2E 恢复为 blocking test；
- 任何 session、元素或断言失败都让 Windows Job 失败；
- 删除 WebView2 150 external-driver warning allowance；
- 更新 ADR 与 ROADMAP，把 external 路线记录为被 embedded Test Build 替代；
- Validation Summary 把 Windows GUI E2E 标为 `PASS`。

如果仍失败，不应泛称“WebView2 上游阻塞”。应保留临时例外，并按日志记录新的实际原因，例如：

- Test Build 未注册插件或 feature 未生效；
- embedded port 占用或 `/status` 未就绪；
- 应用在 server ready 前崩溃；
- Windows WebView2 原生执行器的具体兼容问题；
- service / plugin 版本不兼容；
- sidecar 在独立 target directory 中缺失。

只有取得 GitHub Actions 运行链接和日志后，才能判断是实现配置问题还是第三方组件缺陷。

## 7. 已知风险与边界

- **安全能力较强。** 即使 server 只绑定 `127.0.0.1`，Test Build 仍可被本机进程驱动。必须同时做到 optional feature、条件注册、独立 build 目录、不上传测试二进制。
- **组件较新。** service 和 plugin 当前为 `1.3.0`，应锁定 npm lockfile 与 Cargo lockfile，并让 CI 而不是文档假设证明稳定性。
- **端口竞争。** 默认 `4445` 可能被占用；保持单实例，失败时明确报告端口，不做无限随机重试。
- **测试对象仍是 WebView。** 它能验证 SCOPE 页面元素和交互，不能验证 NSIS、SmartScreen、Defender、系统字体、DPI 或原生文件选择器；这些仍属于 Windows Project Owner UAT。
- **不能把 CI 绿色扩大解释。** 如果 GUI E2E 被跳过或 warning 放行，状态必须是 `BLOCKED` 或 `NOT RUN`，不能因 Workflow 绿色写成 `PASS`。

## 8. 建议的验证证据

本 Spike 最少保留：

| 项目                | 所需证据                                                      |
| ------------------- | ------------------------------------------------------------- |
| Test Build 隔离     | 普通 Cargo feature graph 不含插件；E2E graph 包含插件         |
| Production 安全边界 | 正式 bundle 在 Test Build 前生成；上传路径不含独立 E2E target |
| Windows 应用启动    | service 日志显示启动指定 Test Build                           |
| WebDriver session   | WebdriverIO session 成功建立，无 warning 放行                 |
| GUI smoke           | 稳定 `data-testid` 元素可见                                   |
| CI 阻塞性           | 人为失败断言时 Windows Job 必须失败，正常断言时通过           |

## 项目负责人说明

旧路线像是让一个外部遥控器通过微软浏览器的调试入口控制 SCOPE。WebView2 150 在管理员环境中关掉了这类入口，因此 GitHub 的 Windows 机器无法继续使用它。embedded 路线是在“专门的测试版 SCOPE”内部装一个只供自动测试使用的控制接口，绕开外部调试入口。

最大风险不是技术复杂度，而是误把这个控制接口带进正式安装包。推荐方案用独立开关和独立构建目录把测试版与正式版分开；普通正式构建没有插件代码，单靠环境变量也不能开启它。项目负责人本轮不需要选择新框架或购买服务；需要关注的验收点只有两项：Windows CI 是否获得真实 `PASS`，以及正式安装包是否有可审计的隔离证据。
