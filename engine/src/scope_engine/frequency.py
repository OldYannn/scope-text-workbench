from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from openpyxl import Workbook  # type: ignore[import-untyped]

from . import __version__
from .stopwords import (
    SCOPE_PROFILE_ID,
    filter_tokens,
    import_stopword_file,
    resolve_stopwords,
)

FREQUENCY_IMPLEMENTATION_VERSION = "1"
EXPORT_HEADERS = [
    "词语",
    "词频（TF）",
    "文档频率（DF）",
    "文档覆盖率",
    "标准化词频（每万词，RF10K）",
]


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def analyze_documents(
    documents: list[dict[str, Any]],
    profile: dict[str, Any] | None = None,
    *,
    analysis_id: str | None = None,
) -> dict[str, Any]:
    profile = profile or resolve_stopwords()
    stopwords = set(profile["resolved_stopwords"])
    included = [document for document in documents if document.get("tokens")]
    skipped = [document for document in documents if not document.get("tokens")]
    tf: Counter[str] = Counter()
    df: Counter[str] = Counter()
    raw_count = eligible_count = effective_count = 0
    for document in included:
        tokens = document["tokens"]
        raw_count += len(tokens)
        effective, eligible, count = filter_tokens(tokens, stopwords)
        eligible_count += eligible
        effective_count += count
        tf.update(effective)
        df.update(set(effective))
    rows = []
    denominator = effective_count or 1
    document_count = len(included)
    for token, count in tf.items():
        document_frequency = df[token]
        rows.append(
            {
                "token": token,
                "tf": count,
                "df": document_frequency,
                "document_coverage": document_frequency / document_count if document_count else 0.0,
                "rf10k": count / denominator * 10000,
            }
        )
    rows.sort(key=lambda row: (-cast(int, row["tf"]), str(row["token"])))
    manifest = {
        "analysis_id": analysis_id,
        "included_document_ids": [document["document_id"] for document in included],
        "included_document_count": document_count,
        "excluded_document_ids": [document["document_id"] for document in skipped],
        "tokenization_dependencies": [
            document.get("tokenization_manifest") for document in included
        ],
        "stopword_base_profile_id": profile["base_profile_id"],
        "stopword_base_profile_version": profile["base_profile_version"],
        "stopword_base_profile_hash": profile["base_profile_hash"],
        "extension_profiles": profile.get("extension_profiles", []),
        "custom_additions": profile["custom_additions"],
        "custom_exclusions": profile["custom_exclusions"],
        "resolved_stopword_snapshot": profile["resolved_stopwords"],
        "resolved_stopword_hash": profile["resolved_stopword_hash"],
        "raw_token_count": raw_count,
        "eligible_token_count": eligible_count,
        "effective_token_count": effective_count,
        "tf_definition": "TF(w) = total occurrences of token w in included documents after filtering",
        "df_definition": "DF(w) = number of included documents containing token w at least once",
        "relative_frequency_definition": "RF10K(w) = TF(w) / EffectiveTokenCount * 10000",
        "frequency_implementation_version": FREQUENCY_IMPLEMENTATION_VERSION,
        "executed_at": _now(),
        "network_used": False,
        "software_version": __version__,
    }
    return {
        "rows": rows,
        "candidates": optimization_candidates({"rows": rows, "profile": profile}),
        "manifest": manifest,
        "profile": profile,
        "included_document_count": document_count,
        "skipped_document_count": len(skipped),
    }


def optimization_candidates(
    result: dict[str, Any], *, top_n: int = 100, coverage_threshold: float = 0.8
) -> list[dict[str, Any]]:
    stopwords = set(result["profile"]["resolved_stopwords"])
    candidates = [
        row
        for row in result["rows"]
        if row["token"] not in stopwords and row["document_coverage"] >= coverage_threshold
    ]
    return sorted(candidates, key=lambda row: (-row["tf"], row["token"]))[:top_n]


def export_csv(result: dict[str, Any], destination: str | Path) -> Path:
    path = Path(destination)
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(EXPORT_HEADERS)
        writer.writerows(
            [row["token"], row["tf"], row["df"], row["document_coverage"], row["rf10k"]]
            for row in result["rows"]
        )
    return path


def export_xlsx(result: dict[str, Any], destination: str | Path) -> Path:
    path = Path(destination)
    workbook = Workbook()
    results_sheet = workbook.active
    results_sheet.title = "词频结果"
    results_sheet.append(EXPORT_HEADERS)
    for row in result["rows"]:
        results_sheet.append(
            [row["token"], row["tf"], row["df"], row["document_coverage"], row["rf10k"]]
        )
    results_sheet.freeze_panes = "A2"
    results_sheet.auto_filter.ref = results_sheet.dimensions
    results_sheet.column_dimensions["A"].width = 24
    for column in ("B", "C", "D", "E"):
        results_sheet.column_dimensions[column].width = 22
    for cell in results_sheet["D"][1:]:
        cell.number_format = "0.00%"
    for cell in results_sheet["E"][1:]:
        cell.number_format = "0.00"

    manifest = result["manifest"]
    info_sheet = workbook.create_sheet("分析说明")
    info_sheet.append(["项目", manifest.get("project_name", "")])
    info_sheet.append(["参与文档数", manifest["included_document_count"]])
    info_sheet.append(["raw token count", manifest["raw_token_count"]])
    info_sheet.append(["eligible token count", manifest["eligible_token_count"]])
    info_sheet.append(["effective token count", manifest["effective_token_count"]])
    info_sheet.append(["Stopword Profile", manifest["stopword_base_profile_id"]])
    info_sheet.append(["Stopword hash", manifest["resolved_stopword_hash"]])
    tokenization_dependencies = manifest.get("tokenization_dependencies", [])
    jieba_version = next(
        (
            dependency.get("engine_version")
            for dependency in tokenization_dependencies
            if isinstance(dependency, dict) and dependency.get("engine") == "jieba"
        ),
        "",
    )
    info_sheet.append(["jieba version", jieba_version])
    info_sheet.append(["TF definition", manifest["tf_definition"]])
    info_sheet.append(["DF definition", manifest["df_definition"]])
    info_sheet.append(["Coverage definition", "Coverage(w) = DF(w) / IncludedDocumentCount * 100%"])
    info_sheet.append(["RF10K definition", manifest["relative_frequency_definition"]])
    info_sheet.append(
        [
            "EffectiveTokenCount",
            "完成基础 token eligibility 和当前停用词过滤后，实际参与本次统计的 token 总数。",
        ]
    )
    info_sheet.append(["执行时间", manifest["executed_at"]])
    info_sheet.append(["SCOPE version", manifest["software_version"]])
    info_sheet.column_dimensions["A"].width = 28
    info_sheet.column_dimensions["B"].width = 88
    workbook.save(path)
    return path


def result_hash(result: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(result["rows"], ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()


__all__ = [
    "analyze_documents",
    "optimization_candidates",
    "export_csv",
    "export_xlsx",
    "result_hash",
    "import_stopword_file",
    "SCOPE_PROFILE_ID",
]
