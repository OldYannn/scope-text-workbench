"""Deterministic, local-only method validation for the draft SCOPE stopword profile."""

from __future__ import annotations

import csv
import hashlib
import json
import subprocess
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from openpyxl import Workbook  # type: ignore[import-untyped]

from . import __version__
from .frequency import FREQUENCY_IMPLEMENTATION_VERSION, analyze_documents, result_hash
from .project_store import (
    CLEANING_IMPLEMENTATION_VERSION,
    DEFAULT_CLEANING_RULES,
    DEFAULT_TOKENIZATION_CONFIG,
    TOKENIZATION_IMPLEMENTATION_VERSION,
    TOKENIZER_ENGINE,
    TOKENIZER_VERSION,
    ProjectError,
    clean_text,
    decode_txt,
    tokenize_text,
)
from .stopwords import SCOPE_PROFILE_ID, available_profiles, resolve_stopwords

STOPWORD_VALIDATION_IMPLEMENTATION_VERSION = "1"
CORPUS_ORDER = ("policy", "interview", "academic")
WATCHLIST = ("可能", "因此", "所以", "通过", "根据", "作为", "进行", "出现", "认为", "表示")
CONFIGURATIONS = (
    ("no_stopwords", "No Stopwords", "none"),
    ("scope_draft", "SCOPE Draft", SCOPE_PROFILE_ID),
    ("goto456", "goto456", "goto456-general"),
)
METRIC_HEADERS = [
    "排名",
    "词语",
    "词频（TF）",
    "文档频率（DF）",
    "文档覆盖率",
    "标准化词频（每万词，RF10K）",
]
SUMMARY_HEADERS = [
    "语料",
    "停用词配置",
    "源文档数",
    "DocumentCount",
    "RawTokenCount",
    "EligibleTokenCount",
    "EffectiveTokenCount",
    "语料聚合输入哈希",
]
MANUAL_HEADERS = [
    "候选类型",
    "语料",
    "词语",
    "停用词差异",
    "状态",
    "词频（TF）",
    "文档频率（DF）",
    "文档覆盖率",
    "标准化词频（每万词，RF10K）",
    "排名",
    "是否被 SCOPE 删除",
    "是否被 goto456 删除",
    "人工判断",
    "人工备注",
]
WATCHLIST_HEADERS = [
    "语料",
    "词语",
    "状态",
    "词频（TF）",
    "文档频率（DF）",
    "文档覆盖率",
    "标准化词频（每万词，RF10K）",
    "排名",
    "是否被 SCOPE 删除",
    "是否被 goto456 删除",
]


class ValidationError(ValueError):
    """A clear, non-silent validation harness failure."""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _git_commit() -> str:
    repository_root = Path(__file__).resolve().parents[3]
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repository_root,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unavailable"
    return result.stdout.strip() or "unavailable"


def _read_config(config_path: Path) -> tuple[dict[str, Any], Path]:
    try:
        value = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValidationError(f"无法读取 validation config：{config_path.name}") from error
    if not isinstance(value, dict):
        raise ValidationError("validation config 必须是 JSON object")
    return value, config_path.parent.resolve()


def _configured_path(value: object, config_directory: Path, field: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"validation config 缺少 {field}")
    path = Path(value).expanduser()
    return (config_directory / path).resolve() if not path.is_absolute() else path.resolve()


def _normalize_config(config_path: Path) -> dict[str, Any]:
    source, config_directory = _read_config(config_path)
    corpora = source.get("corpora")
    if not isinstance(corpora, dict):
        raise ValidationError("validation config 必须包含 policy、interview、academic 三类 corpora")
    normalized_corpora: dict[str, dict[str, Any]] = {}
    for label in CORPUS_ORDER:
        specification = corpora.get(label)
        if not isinstance(specification, dict):
            raise ValidationError(f"validation config 缺少 {label} corpus")
        root = _configured_path(
            specification.get("path"), config_directory, f"corpora.{label}.path"
        )
        if not root.is_dir():
            raise ValidationError(f"{label} corpus directory 不存在或不可读取")
        notes = specification.get("notes", "")
        if not isinstance(notes, str):
            raise ValidationError(f"corpora.{label}.notes 必须是字符串")
        normalized_corpora[label] = {"root": root, "notes": notes}
    top_n = source.get("top_n", 100)
    if not isinstance(top_n, int) or isinstance(top_n, bool) or top_n <= 0:
        raise ValidationError("top_n 必须是正整数")
    cleaning = source.get("cleaning", {})
    if not isinstance(cleaning, dict):
        raise ValidationError("cleaning 必须是 object")
    output_path = _configured_path(source.get("output_path"), config_directory, "output_path")
    for label, specification in normalized_corpora.items():
        root = specification["root"]
        if output_path == root or root in output_path.parents or output_path in root.parents:
            raise ValidationError(f"output_path 不能与 {label} corpus directory 重叠")
    return {
        "corpora": normalized_corpora,
        "top_n": top_n,
        "cleaning": {**DEFAULT_CLEANING_RULES, **cleaning},
        "output_path": output_path,
    }


def _corpus_documents(
    root: Path, cleaning_rules: dict[str, Any]
) -> tuple[list[dict[str, Any]], str]:
    paths = sorted(
        (path for path in root.rglob("*") if path.is_file() and path.suffix.casefold() == ".txt"),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    if not paths:
        raise ValidationError("corpus directory 未找到 TXT 文件")
    documents: list[dict[str, Any]] = []
    aggregate_entries: list[str] = []
    for index, path in enumerate(paths, 1):
        logical_document_id = path.relative_to(root).as_posix()
        try:
            raw = path.read_bytes()
            text, _encoding = decode_txt(raw)
            analysis_text, _rules = clean_text(text, cleaning_rules)
            tokens = tokenize_text(analysis_text, DEFAULT_TOKENIZATION_CONFIG)
        except (OSError, ProjectError) as error:
            message = error.message if isinstance(error, ProjectError) else "文件无法读取"
            raise ValidationError(f"读取 {logical_document_id} 失败：{message}") from error
        raw_hash = hashlib.sha256(raw).hexdigest()
        aggregate_entries.append(f"{logical_document_id}\t{raw_hash}")
        documents.append({"document_id": f"document_{index:03d}", "tokens": tokens})
    aggregate_hash = hashlib.sha256(
        "\n".join(sorted(aggregate_entries)).encode("utf-8")
    ).hexdigest()
    return documents, aggregate_hash


def _ranked_rows(result: dict[str, Any], top_n: int) -> list[dict[str, Any]]:
    return [{"rank": rank, **row} for rank, row in enumerate(result["rows"][:top_n], 1)]


def _stats(row: dict[str, Any] | None) -> dict[str, Any]:
    if row is None:
        return {
            "状态": "absent",
            "词频（TF）": 0,
            "文档频率（DF）": 0,
            "文档覆盖率": 0.0,
            "标准化词频（每万词，RF10K）": 0.0,
            "排名": "",
        }
    return {
        "状态": "observed",
        "词频（TF）": row["tf"],
        "文档频率（DF）": row["df"],
        "文档覆盖率": row["document_coverage"],
        "标准化词频（每万词，RF10K）": row["rf10k"],
        "排名": row["rank"],
    }


def _manual_review_rows(results: dict[str, dict[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    scope_words = set(resolve_stopwords(SCOPE_PROFILE_ID)["resolved_stopwords"])
    goto_words = set(resolve_stopwords("goto456-general")["resolved_stopwords"])
    rows: list[dict[str, Any]] = []
    for corpus in CORPUS_ORDER:
        baseline_rows = _ranked_rows(
            results[corpus]["no_stopwords"], len(results[corpus]["no_stopwords"]["rows"])
        )
        baseline = {row["token"]: row for row in baseline_rows}
        scope_rows = _ranked_rows(
            results[corpus]["scope_draft"], len(results[corpus]["scope_draft"]["rows"])
        )

        for token in sorted(scope_words):
            rows.append(
                {
                    "候选类型": "Potential False Positive",
                    "语料": corpus,
                    "词语": token,
                    "停用词差异": "",
                    **_stats(baseline.get(token)),
                    "是否被 SCOPE 删除": "是",
                    "是否被 goto456 删除": "是" if token in goto_words else "否",
                    "人工判断": "",
                    "人工备注": "",
                }
            )
        for row in results[corpus]["scope_draft"]["candidates"]:
            ranked = next(item for item in scope_rows if item["token"] == row["token"])
            rows.append(
                {
                    "候选类型": "Potential False Negative",
                    "语料": corpus,
                    "词语": row["token"],
                    "停用词差异": "Coverage >= 80% review flag",
                    **_stats(ranked),
                    "是否被 SCOPE 删除": "否",
                    "是否被 goto456 删除": "是" if row["token"] in goto_words else "否",
                    "人工判断": "",
                    "人工备注": "",
                }
            )
        for token, row in baseline.items():
            scope_removes = token in scope_words
            goto_removes = token in goto_words
            difference = (
                "both remove"
                if scope_removes and goto_removes
                else "SCOPE only"
                if scope_removes
                else "goto456 only"
                if goto_removes
                else "neither"
            )
            rows.append(
                {
                    "候选类型": "SCOPE vs goto456 Difference",
                    "语料": corpus,
                    "词语": token,
                    "停用词差异": difference,
                    **_stats(row),
                    "是否被 SCOPE 删除": "是" if scope_removes else "否",
                    "是否被 goto456 删除": "是" if goto_removes else "否",
                    "人工判断": "",
                    "人工备注": "",
                }
            )
    return rows


def _watchlist_rows(results: dict[str, dict[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    scope_words = set(resolve_stopwords(SCOPE_PROFILE_ID)["resolved_stopwords"])
    goto_words = set(resolve_stopwords("goto456-general")["resolved_stopwords"])
    rows: list[dict[str, Any]] = []
    for corpus in CORPUS_ORDER:
        baseline_rows = _ranked_rows(
            results[corpus]["no_stopwords"], len(results[corpus]["no_stopwords"]["rows"])
        )
        baseline = {row["token"]: row for row in baseline_rows}
        for token in WATCHLIST:
            rows.append(
                {
                    "语料": corpus,
                    "词语": token,
                    **_stats(baseline.get(token)),
                    "是否被 SCOPE 删除": "是" if token in scope_words else "否",
                    "是否被 goto456 删除": "是" if token in goto_words else "否",
                }
            )
    return rows


def _comparison_rows(result: dict[str, Any], label: str, top_n: int) -> list[dict[str, Any]]:
    return [
        {
            "停用词配置": label,
            "排名": row["rank"],
            "词语": row["token"],
            "词频（TF）": row["tf"],
            "文档频率（DF）": row["df"],
            "文档覆盖率": row["document_coverage"],
            "标准化词频（每万词，RF10K）": row["rf10k"],
        }
        for row in _ranked_rows(result, top_n)
    ]


def _write_csv(path: Path, headers: list[str], rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=headers, extrasaction="raise")
        writer.writeheader()
        writer.writerows(rows)


def _append_sheet(
    workbook: Workbook, title: str, headers: list[str], rows: Iterable[dict[str, Any]]
) -> None:
    sheet = workbook.create_sheet(title)
    sheet.append(headers)
    for row in rows:
        sheet.append([row.get(header, "") for header in headers])
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    for column in sheet.columns:
        letter = column[0].column_letter
        sheet.column_dimensions[letter].width = min(
            42, max(14, max(len(str(cell.value or "")) for cell in column) + 2)
        )
    for index, header in enumerate(headers, 1):
        if header == "文档覆盖率":
            for cell in list(sheet.columns)[index - 1][1:]:
                if cell.value != "":
                    cell.number_format = "0.00%"
        if header == "标准化词频（每万词，RF10K）":
            for cell in list(sheet.columns)[index - 1][1:]:
                if cell.value != "":
                    cell.number_format = "0.00"


def _write_xlsx(
    path: Path,
    summary: list[dict[str, Any]],
    results: dict[str, dict[str, dict[str, Any]]],
    top_n: int,
    review_rows: list[dict[str, Any]],
    watchlist_rows: list[dict[str, Any]],
    manifest: dict[str, Any],
) -> None:
    workbook = Workbook()
    workbook.remove(workbook.active)
    _append_sheet(workbook, "语料概览", SUMMARY_HEADERS, summary)
    sheet_names = {
        "policy": "政策",
        "interview": "访谈",
        "academic": "学术",
    }
    suffixes = {"no_stopwords": "NoStop", "scope_draft": "SCOPE", "goto456": "goto456"}
    for corpus in CORPUS_ORDER:
        for key, _label, _profile_id in CONFIGURATIONS:
            rows = _comparison_rows(results[corpus][key], _label, top_n)
            slim_rows = [{header: row[header] for header in METRIC_HEADERS} for row in rows]
            _append_sheet(
                workbook, f"{sheet_names[corpus]}_{suffixes[key]}", METRIC_HEADERS, slim_rows
            )
    _append_sheet(workbook, "人工复核矩阵", MANUAL_HEADERS, review_rows)
    _append_sheet(workbook, "争议词观察", WATCHLIST_HEADERS, watchlist_rows)
    manifest_rows = [
        {"字段": key, "值": json.dumps(value, ensure_ascii=False, sort_keys=True)}
        for key, value in manifest.items()
    ]
    _append_sheet(workbook, "运行清单", ["字段", "值"], manifest_rows)
    workbook.save(path)


def _summary_markdown(
    summary: list[dict[str, Any]], results: dict[str, dict[str, dict[str, Any]]]
) -> str:
    lines = [
        "# SCOPE 中文通用 v1 Draft 停用词验证摘要",
        "",
        "本文件只记录本次运行的观察事实，不自动给出停用词方法结论或词表修改建议。",
        "",
    ]
    for corpus in CORPUS_ORDER:
        no_stop = next(
            row for row in summary if row["语料"] == corpus and row["停用词配置"] == "No Stopwords"
        )
        scope = next(
            row for row in summary if row["语料"] == corpus and row["停用词配置"] == "SCOPE Draft"
        )
        removed = len(
            set(row["token"] for row in results[corpus]["no_stopwords"]["rows"])
            & set(resolve_stopwords(SCOPE_PROFILE_ID)["resolved_stopwords"])
        )
        retained = len(results[corpus]["scope_draft"]["candidates"])
        lines.extend(
            [
                f"## {corpus}",
                "",
                f"- 源文档数：{no_stop['源文档数']}；参与统计的 DocumentCount：{no_stop['DocumentCount']}。",
                f"- No Stopwords EffectiveTokenCount：{no_stop['EffectiveTokenCount']}；SCOPE Draft EffectiveTokenCount：{scope['EffectiveTokenCount']}。",
                f"- No Stopwords baseline 中观察到的 SCOPE Draft 词表 token 类型数：{removed}。",
                f"- SCOPE Draft 保留且满足 Coverage >= 80% review flag 的 token 数：{retained}。",
                "",
            ]
        )
    lines.extend(
        [
            "## 人工复核说明",
            "",
            "人工复核矩阵中的“人工判断”和“人工备注”均保持为空；Coverage >= 80% 仅为既有候选检查的便利标记，不是自动纳入停用词的规则。",
            "",
        ]
    )
    return "\n".join(lines)


def run_validation(config_path_value: str | Path) -> dict[str, Any]:
    """Run the local stopword validation harness and write shareable aggregate outputs."""
    config_path = Path(config_path_value).expanduser().resolve()
    if not config_path.is_file():
        raise ValidationError("validation config 不存在")
    config = _normalize_config(config_path)
    corpus_documents: dict[str, list[dict[str, Any]]] = {}
    aggregate_hashes: dict[str, str] = {}
    for label in CORPUS_ORDER:
        documents, aggregate_hash = _corpus_documents(
            config["corpora"][label]["root"], config["cleaning"]
        )
        corpus_documents[label] = documents
        aggregate_hashes[label] = aggregate_hash

    profiles = {item["profile_id"]: item for item in available_profiles()}
    results: dict[str, dict[str, dict[str, Any]]] = {}
    summary: list[dict[str, Any]] = []
    analytical_hashes: dict[str, str] = {}
    for corpus in CORPUS_ORDER:
        results[corpus] = {}
        for key, label, profile_id in CONFIGURATIONS:
            result = analyze_documents(corpus_documents[corpus], resolve_stopwords(profile_id))
            results[corpus][key] = result
            analytical_hashes[f"{corpus}:{key}"] = result_hash(result)
            metrics = result["manifest"]
            summary.append(
                {
                    "语料": corpus,
                    "停用词配置": label,
                    "源文档数": len(corpus_documents[corpus]),
                    "DocumentCount": metrics["included_document_count"],
                    "RawTokenCount": metrics["raw_token_count"],
                    "EligibleTokenCount": metrics["eligible_token_count"],
                    "EffectiveTokenCount": metrics["effective_token_count"],
                    "语料聚合输入哈希": aggregate_hashes[corpus],
                }
            )
    scope_metadata = profiles[SCOPE_PROFILE_ID]
    goto_metadata = profiles["goto456-general"]
    manifest = {
        "run_id": str(uuid.uuid4()),
        "executed_at": _now(),
        "scope_git_commit": _git_commit(),
        "engine_version": __version__,
        "stopword_validation_implementation_version": STOPWORD_VALIDATION_IMPLEMENTATION_VERSION,
        "frequency_implementation_version": FREQUENCY_IMPLEMENTATION_VERSION,
        "cleaning_implementation_version": CLEANING_IMPLEMENTATION_VERSION,
        "cleaning_config": config["cleaning"],
        "tokenization": {
            "engine": TOKENIZER_ENGINE,
            "jieba_version": TOKENIZER_VERSION,
            "mode": DEFAULT_TOKENIZATION_CONFIG["mode"],
            "hmm": DEFAULT_TOKENIZATION_CONFIG["hmm"],
            "user_dictionary": "none",
            "implementation_version": TOKENIZATION_IMPLEMENTATION_VERSION,
        },
        "stopword_configs": {
            "no_stopwords": {
                "name": "No Stopwords",
                "resolved_count": profiles["none"]["count"],
                "sha256": profiles["none"]["hash"],
            },
            "scope_draft": {
                "name": scope_metadata["label"],
                "profile_id": SCOPE_PROFILE_ID,
                "version": scope_metadata["version"],
                "status": scope_metadata["status"],
                "resolved_count": scope_metadata["count"],
                "sha256": scope_metadata["hash"],
            },
            "goto456": {
                "name": goto_metadata["label"],
                "profile_id": "goto456-general",
                "version": goto_metadata["version"],
                "status": goto_metadata["status"],
                "resolved_count": goto_metadata["count"],
                "sha256": goto_metadata["hash"],
                "pinned_source_commit": goto_metadata["source"].get("commit", ""),
            },
        },
        "corpora": {
            corpus: {
                "label": corpus,
                "document_count": len(corpus_documents[corpus]),
                "aggregate_input_sha256": aggregate_hashes[corpus],
                "metrics": {
                    key: {
                        "RawTokenCount": results[corpus][key]["manifest"]["raw_token_count"],
                        "EligibleTokenCount": results[corpus][key]["manifest"][
                            "eligible_token_count"
                        ],
                        "EffectiveTokenCount": results[corpus][key]["manifest"][
                            "effective_token_count"
                        ],
                    }
                    for key, _label, _profile_id in CONFIGURATIONS
                },
            }
            for corpus in CORPUS_ORDER
        },
        "network": False,
        "corpus_hash_algorithm": "SHA256 over sorted relative_logical_document_id + tab + raw_byte_SHA256 entries",
    }
    review_rows = _manual_review_rows(results)
    watchlist_rows = _watchlist_rows(results)
    output_path = config["output_path"]
    output_path.mkdir(parents=True, exist_ok=True)
    _write_csv(output_path / "corpus_summary.csv", SUMMARY_HEADERS, summary)
    for corpus in CORPUS_ORDER:
        rows = [
            row
            for key, label, _profile_id in CONFIGURATIONS
            for row in _comparison_rows(results[corpus][key], label, config["top_n"])
        ]
        _write_csv(
            output_path / f"{corpus}_comparison.csv",
            ["停用词配置", *METRIC_HEADERS],
            rows,
        )
    _write_csv(output_path / "manual_review_matrix.csv", MANUAL_HEADERS, review_rows)
    _write_csv(output_path / "watchlist.csv", WATCHLIST_HEADERS, watchlist_rows)
    (output_path / "validation-summary.md").write_text(
        _summary_markdown(summary, results), encoding="utf-8"
    )
    (output_path / "validation-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    _write_xlsx(
        output_path / "stopword-validation.xlsx",
        summary,
        results,
        config["top_n"],
        review_rows,
        watchlist_rows,
        manifest,
    )
    return {
        "run_id": manifest["run_id"],
        "output_path": str(output_path),
        "analytical_hashes": analytical_hashes,
    }


__all__ = ["ValidationError", "run_validation"]
