# SCOPE 文镜

SCOPE（中文品牌名：文镜）是一个面向人文社会科学研究者的、开源、本地优先、可复现、AI 原生的文本分析工作台。

> **当前状态：Pre-alpha。**
>
> 项目处于 Pre-alpha 阶段，目前不建议将早期版本直接用于正式科研结论。

---

## 为什么要做这个项目？

很多人文社会科学研究者存在真实的文本分析需求，但并不希望为了：

- 中文分词；
- 词频统计；
- TF-IDF；
- 共词分析；
- 网络分析；
- 文本分类；
- AI 编码；

自行搭建和维护完整的 Python 技术栈。

传统的图形化文本分析软件虽然降低了学习门槛，但不少工具已经多年缺乏更新，难以充分利用现代 NLP 和大语言模型能力。

本项目希望建立一套现代化的研究工作台，将：

- 中文文本预处理；
- 词频与 TF-IDF；
- 共词分析；
- 网络数据导出；
- 研究过程可复现记录；
- 可选的大语言模型结构化编码；
- 后续的人机协同可靠性分析；

整合到统一的软件中。

软件即使没有配置 LLM API，也应该能够正常完成传统文本分析。

---

## 核心原则

- 本地优先；
- 研究方法透明；
- 可复现；
- AI Provider 中立；
- 开源；
- 面向非编程研究者；
- 不用“AI 魔法”隐藏关键研究参数。

---

## 第一阶段 Roadmap

首个 Public Alpha 计划重点实现：

1. 语料导入与管理；
2. 文本清洗；
3. 中文分词；
4. 词频 / TF-IDF / N-Gram；
5. 共现分析；
6. CSV / Excel / GraphML 导出；
7. 研究审计链；
8. 实验性的 LLM 结构化编码。

完整项目规划请参阅：

- [PROJECT_BRIEF.md](PROJECT_BRIEF.md)
- [ROADMAP.md](ROADMAP.md)
- [架构决策](docs/adr/0001-desktop-python-sidecar-architecture.md)
- [开发环境说明](docs/development.md)

---

## 当前开发状态

项目处于 Pre-alpha 阶段。

在 v1.0 之前可能发生较大规模的功能、UI 和数据格式调整。

Milestone 0 当前已经建立 React / Tauri 桌面壳、Python sidecar 的初始 NDJSON 协议契约与自动化质量检查。非科研诊断切片已经打通进度、取消、异常恢复和最小可复现清单。冻结 Python sidecar、完整安装包和跨架构验证仍在进行中。

---

## 参与项目

随着基础架构逐渐稳定，项目将欢迎：

- Bug Report；
- Feature Request；
- 真实研究使用场景；
- 文档改进；
- Pull Request；
- 方法学讨论；
- 数据分析案例。

项目进入公开协作阶段前将补充 `CONTRIBUTING.md`。

当前 Private / Pre-alpha 阶段的 README 以中文为主。进入 Public Alpha 前，将规划英文主版 `README.md` 与中文版 `README.zh-CN.md`。

---

## 学术引用

正式 Citation 信息将在项目进入首个研究发布版本后补充。

未来计划加入：

- `CITATION.cff`；
- 软件版本 DOI；
- 软件论文；
- 论文研究方法自动引用信息。

---

## License

尚未确定。

在正式确认 License 前，不应默认假定项目使用 MIT、Apache-2.0 或 GPL。
