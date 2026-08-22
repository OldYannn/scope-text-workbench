# Apache License 2.0 与当前依赖许可证核查

> 核查日期：2026-08-17
>
> 适用阶段：Milestone 2A（在 Milestone 0 快照基础上补充）
>
> 范围：核对 Apache License 2.0 标准文本、`NOTICE` 的适用性，以及当前清单和锁文件中直接核心依赖的明显许可证风险。本文不是法律意见，也不代替公开发布前的完整第三方许可证审计。

## 1. 结论摘要

- 根目录 `LICENSE` 应原样采用 Apache Software Foundation（ASF）发布的 [Apache License 2.0 官方纯文本](https://www.apache.org/licenses/LICENSE-2.0.txt)。ASF 将该许可证的 SPDX 标识写作 `Apache-2.0`。[ASF License 页面](https://www.apache.org/licenses/LICENSE-2.0.html)
- 对 SCOPE 这类 ASF 之外的原创项目，`NOTICE` 可以采用，但并非 Apache-2.0 对许可方无条件要求创建的文件。ASF 对自有软件的建议是加入 `LICENSE`，并“考虑”加入 `NOTICE`。[ASF Licensing FAQ](https://www.apache.org/foundation/license-faq)
- 如果项目加入 `NOTICE`，Apache-2.0 第 4(d) 条会要求下游衍生发行保留其中适用的署名信息；`NOTICE` 只用于信息和署名，不能修改许可证。本项目不应把强制论文引用或额外使用限制写入其中。[Apache License 2.0 第 4(d) 条](https://www.apache.org/licenses/LICENSE-2.0.txt)
- 当前直接核心依赖以 MIT、Apache-2.0、BSD-3-Clause 或相应双许可证为主，没有发现 GPL-only、AGPL、SSPL、自定义使用限制、模型许可证或数据许可证直接阻塞 SCOPE 采用 Apache-2.0。
- PyInstaller 需要单独说明：工具本体采用 GPLv2-or-later，但官方 `Bootloader Exception` 明确允许把编译后的 bootloader 及相关文件嵌入其他程序并分发，不把 GPL 限制扩展到该组合程序。按当前“使用官方 PyInstaller 冻结 sidecar”的方式，未发现明显发布阻塞；如果以后修改或再分发 PyInstaller 本身，仍需按其许可证重新核查。[PyInstaller 官方 COPYING.txt](https://github.com/pyinstaller/pyinstaller/blob/v6.21.0/COPYING.txt)

## 2. 标准 LICENSE 与 GitHub 识别

ASF 官方 FAQ 明确建议在自有软件中包含一份 Apache License，通常命名为 `LICENSE`；同一 FAQ 也说明，修改后的许可证不再是原本的 Apache License。因此，最稳妥的做法是把官方纯文本不作改写地放在仓库根目录。[ASF Licensing FAQ](https://www.apache.org/foundation/license-faq)

GitHub 的许可证 API 将该许可证的 key 和 SPDX 标识分别列为 `apache-2.0` 与 `Apache-2.0`。[GitHub REST API licenses 文档](https://docs.github.com/en/rest/licenses/licenses) 根目录文件采用官方完整正文后，可以再通过 GitHub Repository API 的 `license.spdx_id` 或仓库首页进行实证确认；仅凭本地文件不能代替 GitHub 端的识别结果。

## 3. NOTICE 是否适合当前项目

Apache-2.0 本身的规则是条件式的：只有当原作品发行物包含 `NOTICE` 时，下游衍生发行才需要复制其中适用的署名信息。许可证同时明确说，`NOTICE` 的内容仅供信息用途，不能修改许可证。[Apache License 2.0 第 4(d) 条](https://www.apache.org/licenses/LICENSE-2.0.txt)

ASF 要求 ASF 自身的软件发行物包含 `NOTICE`，但 ASF 官方政策明确说明这套内部政策不适用于 ASF 之外的项目。[ASF Source Header and Copyright Notice Policy](https://www.apache.org/legal/src-headers.html)

因此，对 SCOPE 的实施建议是：

- 若希望项目名称和经确认的版权归属随衍生发行物保留，创建简洁 `NOTICE` 是合适的；
- `NOTICE` 只放项目署名及必要的第三方 attribution（署名）信息，不加入用途限制、强制论文引用或额外许可证条件；
- 当前版权主体拟以项目负责人个人名义处理，但 Git 提交显示名或 GitHub 用户名不足以可靠证明法律意义上的版权姓名。正式写入个人姓名前，应由项目负责人明确提供希望公开展示的版权持有人姓名；
- 如果该姓名本轮尚未确认，可以先只加入标准 `LICENSE`，待确认后再创建 `NOTICE`，这不会影响仓库采用 Apache-2.0。

## 4. 当前直接核心依赖

核查对象来自以下项目文件：

- `package.json`、`package-lock.json`；
- `apps/desktop/package.json`；
- `tests/e2e/package.json`、`tests/e2e/package-lock.json`；
- `apps/desktop/src-tauri/Cargo.toml`、`Cargo.lock`；
- `engine/pyproject.toml`。

### 4.1 产品运行时与桌面构建

| 依赖组                      | 当前锁定或声明                  | 一手许可证信息                                                                                                                                                    | 初步结果                                 |
| --------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| React、React DOM            | 锁定 `19.2.8`                   | npm 官方 registry 元数据均为 MIT；React 官方仓库同样附 MIT license。[React 官方仓库](https://github.com/facebook/react)                                           | 未发现明显冲突                           |
| Tauri JS API、Tauri CLI     | 锁定 `2.11.1`、`2.11.4`         | npm 元数据为 `Apache-2.0 OR MIT`；Tauri 官方仓库采用同一双许可证。[Tauri 官方仓库](https://github.com/tauri-apps/tauri)                                           | 可选择 Apache-2.0 或 MIT，未发现明显冲突 |
| Tauri Rust、tauri-build     | Cargo lock 为 `2.11.5`、`2.6.3` | crates.io/Cargo package metadata 为 `Apache-2.0 OR MIT`。[tauri crate](https://crates.io/crates/tauri)、[tauri-build crate](https://crates.io/crates/tauri-build) | 未发现明显冲突                           |
| serde_json                  | Cargo lock 为 `1.0.151`         | Cargo package metadata 为 `MIT OR Apache-2.0`。[serde_json 官方仓库](https://github.com/serde-rs/json)                                                            | 未发现明显冲突                           |
| tauri-plugin-wdio-webdriver | 测试专用，锁定 `1.3.0`          | Cargo package metadata为 MIT。[WebdriverIO desktop-mobile 官方仓库](https://github.com/webdriverio/desktop-mobile)                                                | 未发现明显冲突；仍须保持 test-only 隔离  |

### 4.2 JavaScript 开发与 GUI E2E 工具

当前直接开发依赖中的 ESLint、Testing Library、React type definitions、Vite React plugin、React lint plugins、globals、jsdom、Prettier、typescript-eslint、Vite 和 Vitest，在 npm 锁文件所记录版本的 package metadata 中均为 MIT；TypeScript 为 Apache-2.0。相关版本和许可证字段可以由 npm 官方 registry 的逐版本元数据复核，例如 [TypeScript 5.8.3](https://registry.npmjs.org/typescript/5.8.3)、[Vite 7.3.6](https://registry.npmjs.org/vite/7.3.6) 和 [Vitest 4.1.10](https://registry.npmjs.org/vitest/4.1.10)。

Windows GUI E2E 的 WebdriverIO 直接依赖（`@wdio/cli`、`@wdio/globals`、`@wdio/local-runner`、`@wdio/mocha-framework`、`@wdio/spec-reporter`、`@wdio/tauri-service`、`webdriverio`）在锁定版本的 npm metadata 中均为 MIT。[WebdriverIO 官方仓库](https://github.com/webdriverio/webdriverio)、[desktop-mobile 官方仓库](https://github.com/webdriverio/desktop-mobile)

E2E lockfile 中覆盖的 `serialize-javascript 7.0.5` 为 BSD-3-Clause。[npm registry metadata](https://registry.npmjs.org/serialize-javascript/7.0.5) 未发现明显 Apache-2.0 发布冲突。

### 4.3 Python 构建与开发工具

Python sidecar 当前没有产品运行时第三方依赖。直接工具依赖如下：

| 依赖        | 声明范围    | 一手许可证信息                                                                                                                                                                                                                     | 初步结果                                             |
| ----------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| setuptools  | `>=77,<81`  | PyPI 元数据为 MIT。[PyPI](https://pypi.org/project/setuptools/)                                                                                                                                                                    | 未发现明显冲突                                       |
| PyInstaller | `==6.21.0`  | GPLv2-or-later，并有允许把 bootloader 嵌入和分发到其他程序的专门例外。[官方 COPYING.txt](https://github.com/pyinstaller/pyinstaller/blob/v6.21.0/COPYING.txt)、[PyPI JSON metadata](https://pypi.org/pypi/pyinstaller/6.21.0/json) | 当前冻结方式未见明显阻塞；修改或再分发工具本体需重查 |
| mypy        | `>=1.17,<2` | MIT。[mypy 官方仓库](https://github.com/python/mypy)                                                                                                                                                                               | 未发现明显冲突                                       |
| Ruff        | `>=0.12,<1` | MIT。[Ruff 官方仓库](https://github.com/astral-sh/ruff)                                                                                                                                                                            | 未发现明显冲突                                       |
| jieba       | `==0.42.1`  | MIT。jieba 0.42.1 源码发行包包含 MIT License 文本。                                                                                                                                            | 与 Apache-2.0 集成未发现明显冲突；版本固定 |

## 5. 有限的锁文件风险扫描

对当前 npm 与 Cargo 依赖树的许可证 metadata 做关键词扫描后：

- 未发现 GPL-only、AGPL、SSPL、BUSL 或 Commons Clause 条目；
- E2E 的传递依赖 `jszip` 标记为 `MIT OR GPL-3.0-or-later`，可按 MIT 条款使用，不构成 GPL-only 风险；[jszip 官方仓库](https://github.com/Stuk/jszip)
- Cargo 的传递依赖 `r-efi` 标记为 `MIT OR Apache-2.0 OR LGPL-2.1-or-later`，存在 MIT/Apache-2.0 选项，不构成 LGPL-only 风险；[r-efi 官方仓库](https://github.com/r-efi/r-efi)
- E2E 的旧传递包 `css-value 0.0.1` 未在 `package.json` 提供机器可读 `license` 字段，但包内 README 附有完整 MIT 文本。这是 metadata 完整性问题，目前没有发现限制性条款；正式发布第三方清单时仍应保留人工复核记录。[npm package](https://www.npmjs.com/package/css-value)
- 当前未引入模型或数据集，因此本轮不存在模型权重、训练数据或示例语料许可证需要判断。

这些检查只能发现清单中较明显的信号，不能保证所有传递依赖、构建产物内文件、系统框架和未来依赖都已完成法律审计。

## 6. Public 前仍需完成的许可证卫生工作

本轮没有发现阻碍仓库源码从 Private 切换为 Public 的明显依赖许可证问题。为了后续发布安装包，建议保留以下低成本后续事项：

1. 明确项目负责人的公开版权持有人姓名，再决定 `NOTICE` 中的版权行；
2. 在 Public Alpha / Release 前生成并人工抽查第三方软件清单，确认安装包携带各依赖要求的版权和许可证文本；
3. 每次新增核心依赖、模型或数据集时单独记录其许可证，不把本次快照当作永久结论；
4. `CITATION.cff` 只承载学术引用建议，不把引用要求混入 `LICENSE` 或 `NOTICE`。

## 项目负责人说明

Apache-2.0 决定了别人可以怎样合法使用、修改和分发 SCOPE；学术论文引用属于另一套学术规范，应由 `CITATION.cff` 和 README 管理。两者分开，可以避免把学术期待误写成软件使用限制。

当前依赖没有发现会迫使 SCOPE 改用 GPL、禁止商业使用或限制研究用途的明显问题。PyInstaller 的许可证文字看起来最需要警惕，但其官方例外正是为了允许冻结后的程序正常分发。当前不需要更换打包工具；真正需要在发布前完成的是一份可追踪的第三方许可证清单，而不是现在扩大成全面法律审计。
