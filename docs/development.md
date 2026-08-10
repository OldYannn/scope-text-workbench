# 开发环境说明

SCOPE 当前处于 Pre-alpha。本页说明如何验证技术脚手架，当前版本不能用于产生正式研究结论。

GUI 测试、Computer Use 和项目负责人人工验收的边界见 [`docs/testing/gui-testing.md`](testing/gui-testing.md)。默认先使用自动化测试，只有 GUI 特有行为才使用最小范围的 Computer Use。

## 环境要求

- Node.js 24；
- Python 3.11 或更高版本，CI 当前使用 Python 3.12；
- 稳定版 Rust 工具链，以及 `rustfmt` 和 `clippy`；
- macOS 或 Windows 对应的 Tauri 2 系统依赖。

这些工具只供开发者使用。最终用户不应自行安装这些开发环境；正式安装包需要包含已编译前端、Rust 桌面壳和冻结后的 Python sidecar。

## 安装依赖

在仓库根目录执行：

```shell
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -e "engine[dev,packaging]"
```

Windows 用户需要先激活虚拟环境，再使用其中的 `python`，而不是 `.venv/bin/python`。

## 质量检查

```shell
npm run check
npm run lint
npm test
npm run format:check
npm run build

.venv/bin/ruff check engine scripts
.venv/bin/ruff format --check engine scripts
.venv/bin/mypy engine/src engine/tests engine/packaging scripts
.venv/bin/python -m unittest discover -s engine/tests -v

cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

这些命令分别检查 TypeScript 类型、代码规范、格式、前端构建、Python 类型与测试，以及 Rust 代码质量和分析引擎生命周期。

## 启动开发版桌面壳

```shell
npm run tauri -- dev
```

开发版会从仓库根目录的 `.venv` 启动 Python 分析引擎。桌面首页的“基础链路诊断”可以验证：

- 逐步进度能否从 Python 到达 React；
- 正在运行的任务能否安全取消；
- Python 异常退出后，新请求能否启动新进程；
- 成功结果能否显示最小可复现清单。

该诊断不读取语料，也不产生研究结论。Release 构建从应用包内启动冻结后的 sidecar，不会改用用户电脑上的系统 Python。如果打包文件缺失或无法启动，会返回明确错误。

只检查浏览器前端时，可以执行：

```shell
npm run dev --workspace @scope-workbench/desktop-dev
```

## 冻结并验证 Python sidecar

PyInstaller 必须在目标操作系统和 CPU 架构上原生运行，不能用一个平台交叉生成其他平台的可执行文件。在仓库根目录执行：

```shell
.venv/bin/python scripts/build_sidecar.py
.venv/bin/python scripts/verify_sidecar.py
```

构建脚本会读取 Rust host target triple（宿主目标三元组），生成 Tauri 要求的 `scope-engine-dev-<target-triple>` 文件。验证脚本会移除 `PYTHONHOME` 和 `PYTHONPATH`，再检查协议描述、进度、可复现清单及异常退出，证明产物不依赖系统 Python。

`scope-engine-dev` 仍是开发阶段内部标识，不代表正式 Package Name 已获批。

## 构建桌面安装包

```shell
npm run tauri -- build
```

运行前必须先为当前平台构建冻结 sidecar。macOS 还可以用以下命令自动验证应用包结构、包内 sidecar 和开发签名：

```shell
.venv/bin/python scripts/verify_macos_bundle.py \
  "apps/desktop/src-tauri/target/release/bundle/macos/SCOPE 文镜 (Development).app"
```

CI 会分别在 macOS arm64、macOS x64 和 Windows x64 原生 Runner 上构建 sidecar 与安装包，并保存开发构建产物。当前 macOS 使用 ad-hoc 开发签名，Windows 构建未配置发布证书；这些产物只能用于技术验证，不能作为公开 Release。

## 开发阶段临时标识

npm workspace、Python distribution、Rust crate 和 Tauri Bundle ID 当前包含 `dev`，或已明确标记为开发占位符。在技术标识和 License 获批前，不得发布到 Package Registry，也不得用于公开 Release。

Tauri 自动生成的应用图标同样只是临时开发资产。公开构建前必须替换为获批的 SCOPE 品牌资产。
