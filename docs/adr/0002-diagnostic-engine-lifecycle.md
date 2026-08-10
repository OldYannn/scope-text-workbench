# ADR 0002：Diagnostic tracer bullet 与分析引擎生命周期

- 状态：Milestone 0 已接受
- 日期：2026-08-10
- 决策者：SCOPE 项目维护者

## 项目负责人说明

- 为什么需要：在开发真实文本分析前，必须先证明桌面界面能够稳定启动 Python、显示进度、取消任务，并在 Python 意外退出后恢复。
- 解决的问题：用一个不处理语料、不产生科研结论的 diagnostic（技术诊断）任务，贯穿 React、Rust 和 Python 三层，尽早暴露跨进程通信风险。
- 主要风险：并发消息可能错配；取消可能来得太晚；进程崩溃时可能留下“看似成功”的假结果；开发环境可以使用系统内虚拟环境，但正式安装包仍必须冻结 Python。
- 需要项目负责人决策：本切片不锁定正式 Bundle ID、Package Name 或项目文件格式，也不选择 License。正式发布前仍需确认这些事项。

## 背景

ADR 0001 已确定 Rust 负责 sidecar 生命周期，Python 负责研究与项目行为。仅有静态桌面壳和 `system.describe` 协议还不能证明该架构能够支持耗时分析任务。

本切片必须验证：

1. Rust 启动一个长期运行的 Python 进程；
2. 多条协议消息按 `request_id` 正确分发；
3. Python 能发送进度，React 能显示进度；
4. 取消请求不会被记录成成功；
5. Python 异常退出时，等待中的请求得到明确错误；
6. 下一次请求能够自动启动新进程；
7. 成功结果携带最小可复现清单。

## 决策

Python 引擎新增三个仅供 Milestone 0 使用的方法：

- `diagnostic.run`：按确定性步骤发送进度并返回可复现清单；
- `request.cancel`：设置目标请求的协作式取消信号；
- `diagnostic.crash`：以非零退出码终止进程，用于验证 Rust 恢复逻辑。

Rust 新增一个进程监督 Module（模块）。它的 Interface（调用方需要了解的全部接口）只负责：发送请求、接收与该请求关联的消息、取消请求，以及在进程不可用时自动重启。子进程标准输入输出、reader thread（读取线程）、消息路由和待处理请求表都属于内部 Implementation（实现），不暴露给 React。

开发模式使用仓库 `.venv` 中的 Python 启动 `scope_engine`。Release 模式在冻结 sidecar 完成前明确返回“未配置打包引擎”，不能静默退回用户系统 Python。

## 取消语义

取消采用 cooperative cancellation（协作式取消）：运行任务定期检查取消信号。目标任务最终返回 `cancelled` 错误；取消请求本身返回是否接受取消。即使任务恰好已经结束，也不得把已经取消的任务伪装为成功。

## 异常恢复语义

Python 进程退出时，Rust 将所有仍在等待的请求标记为 `engine_exited`，丢弃旧进程状态。下一次请求自动启动新进程。自动重启不重放旧请求，避免重复执行未来可能修改项目的研究任务。

## 可复现清单

`diagnostic.run` 的结果记录操作名称、操作版本、完整参数、分析引擎版本、协议版本、随机种子、输入哈希列表和网络使用情况。该任务没有语料输入，也不使用随机数，因此 `input_hashes` 为空、`random_seed` 为 `null`、`network_used` 为 `false`。

## 影响与后续

本切片验证的是进程基础设施，不是研究审计链的完整实现。后续研究方法加入前，需要把动态 JSON envelope 升级为明确 Schema，并将冻结 sidecar 接入相同生命周期 Module。
