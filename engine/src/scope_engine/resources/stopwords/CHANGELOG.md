# Stopword CHANGELOG

## scope-cn-general-v1 (draft)

- 初始版本，采用高共识功能词和指示/代词。
- 不因单字、高频或高 DF 自动删除内容词；`党`、`法`、`权`、`人`、`政策`、`社会` 等词不在表内。
- 当前为 Draft，Public Alpha 前须通过多类型真实语料和项目负责人 UAT；本轮不因 review 建议擅自增删 `可能`、`因此`、`所以`、`通过`、`根据`、`作为`、`进行`、`出现`、`认为`、`表示`。
- Draft 清理了与简体 `已经` 重复语义的繁体变体 `已經`，使当前 frozen SCOPE v1 unique count 固定为 85；该决定仍需 Project Owner UAT 复核。

## Lifecycle

- `draft`：项目负责人可基于真实语料审核和修改。
- `released`：禁止静默修改；任何变更必须产生 `v1.1` 或 `v2`，保留旧版本并记录增加、删除及原因。
