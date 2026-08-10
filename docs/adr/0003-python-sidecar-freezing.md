# ADR 0003：Python sidecar 冻结与原生平台打包

- 状态：Milestone 0 实施中
- 日期：2026-08-10
- 决策者：SCOPE 项目维护者

## 项目负责人说明

- 为什么需要：普通研究者安装 SCOPE 后，不应再自行安装 Python、创建虚拟环境或处理依赖版本。
- 解决的问题：把 Python 分析引擎及其依赖冻结成随桌面应用分发的可执行文件，并在三个目标平台用同一份协议验证。
- 主要风险：每个平台必须原生构建；单文件模式启动时需要临时解压，可能增加首次启动时间或触发杀毒软件误报；macOS 与 Windows 的正式签名尚未配置。
- 需要项目负责人决策：公开发布前需要确认 Apple Developer 与 Windows 代码签名方案。当前开发签名和临时技术标识不得直接用于公开 Release。

## 背景

ADR 0001 已确定 Tauri 桌面壳加 Python sidecar 的架构，ADR 0002 已验证进度、取消、异常恢复和可复现清单。本切片需要证明同一 NDJSON 0.1 协议在不依赖系统 Python 的冻结产物中继续成立，并能进入真实桌面应用包。

## 决策

Milestone 0 采用以下方案：

1. 使用 PyInstaller 6.21.0 的 `onefile` 模式冻结 Python 分析引擎；
2. 通过 Tauri `bundle.externalBin` 把对应 target triple（目标平台三元组）的产物加入应用包；
3. Debug 构建继续使用仓库 `.venv`，Release 构建只从应用包内启动 sidecar；
4. 在 macOS arm64、macOS x64 和 Windows x64 的原生 CI Runner 上分别构建，不进行跨平台交叉冻结；
5. 冻结产物必须在移除 `PYTHONHOME` 与 `PYTHONPATH` 后通过协议、进度、可复现清单和异常退出验证；
6. `scope-engine-dev` 只是当前开发期内部标识，不锁定未来应用内部标识或 Package Name。

选择 `onefile` 是为了先用最小分发边界验证 Tauri 与 Python 的集成。它不会改变 Rust Supervisor 或 NDJSON 协议。如果后续依赖体积、启动速度、临时目录限制或安全软件误报不可接受，可以改为 `onedir` 或其他冻结方式，而不重写研究算法接口。

## macOS 开发签名

PyInstaller 会对单文件内部收集的动态库进行签名；这些内部文件在运行时才解压，之后无法单独补签。Tauri 对外层 sidecar 启用 Hardened Runtime（强化运行时）后，ad-hoc 开发签名没有共同 Team ID，macOS Library Validation（库校验）会拒绝加载内嵌 Python 运行库。

因此，当前仅用于 Pre-alpha 技术验证的 macOS 配置采用：

- Tauri ad-hoc 签名身份 `-`；
- `com.apple.security.cs.disable-library-validation` 开发期 entitlement（权限声明）。

该 entitlement 会降低 sidecar 进程的库加载保护，只是无开发者证书阶段的权衡，不代表正式发布方案。公开发布前应使用同一 Apple Developer ID 签名 PyInstaller 收集的文件和 Tauri 应用，完成 notarization（Apple 公证），并重新验证能否移除该例外。

## 依赖与可复现性

直接冻结工具 `pyinstaller==6.21.0` 精确固定。当前其传递依赖仍由安装器解析，CI 运行环境也可能随 Runner 镜像更新。进入公开发布准备时，需要保存完整构建依赖锁、Runner 与 SDK 版本、目标架构、产物哈希和签名信息。

冻结产物属于构建输出，不提交到 Git。CI 生成的开发安装包作为短期 Artifact（构建产物）保存，不能替代正式 Release 资产。

## 自动化验收边界

本切片的自动化证据包括：

- 冻结 sidecar 的 NDJSON 契约和异常退出；
- Tauri Release 构建成功；
- macOS `.app` 内包含桌面主程序与 sidecar；
- 包内 sidecar 可独立执行；
- macOS 整包通过严格代码签名校验；
- 三个目标平台的 CI 原生构建产物存在。

安装程序真实打开、首次启动、按钮交互和视觉状态属于 GUI 特有行为，应在安装包稳定后按独立 Test Flow 做最小 Computer Use smoke test，或交由项目负责人按独立 UAT 清单验收。本 ADR 不把“安装包构建成功”写成“用户安装验收通过”。

## 尚未解决的发布风险

- macOS Developer ID 签名与公证；
- Windows Authenticode 签名、SmartScreen 提示和杀毒软件误报；
- `onefile` 临时解压目录的权限、符号链接支持和启动性能；
- Python 与研究依赖增长后的安装包体积；
- GitHub Runner 镜像变化和传递依赖漂移；
- 正式 Bundle ID、内部可执行文件名及 Package Name 尚未获批。
