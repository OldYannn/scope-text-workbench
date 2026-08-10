# SCOPE 研究分析引擎（开发包）

本目录保存本地 Python sidecar。当前 Package Name 和 Distribution Name 都是开发阶段占位符；在技术标识和 License 获批前不得对外发布。

在仓库根目录运行协议契约测试：

```shell
python3 -m unittest discover -s engine/tests -v
```

运行开发版分析引擎：

```shell
PYTHONPATH=engine/src python3 -m scope_engine
```
