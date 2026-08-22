from __future__ import annotations

import csv
import hashlib
import json
import zipfile
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from xml.sax.saxutils import escape

from . import __version__
from .stopwords import (
    SCOPE_PROFILE_ID,
    filter_tokens,
    import_stopword_file,
    resolve_stopwords,
)

FREQUENCY_IMPLEMENTATION_VERSION = "1"


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
        writer = csv.DictWriter(
            stream, fieldnames=["token", "tf", "df", "document_coverage", "rf10k"]
        )
        writer.writeheader()
        writer.writerows(result["rows"])
    return path


def export_xlsx(result: dict[str, Any], destination: str | Path) -> Path:
    def sheet_xml(rows: list[list[Any]]) -> str:
        body = []
        for row_number, row in enumerate(rows, 1):
            cells = []
            for column, value in enumerate(row, 1):
                ref = f"{chr(64 + column)}{row_number}"
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    cells.append(f'<c r="{ref}"><v>{value}</v></c>')
                else:
                    cells.append(
                        f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
                    )
            body.append(f'<row r="{row_number}">{"".join(cells)}</row>')
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
            + "".join(body)
            + "</sheetData></worksheet>"
        )

    result_rows = [["token", "TF", "DF", "document coverage", "RF10K"]] + [
        [r["token"], r["tf"], r["df"], r["document_coverage"], r["rf10k"]] for r in result["rows"]
    ]
    info_rows = [
        [key, json.dumps(value, ensure_ascii=False) if isinstance(value, (list, dict)) else value]
        for key, value in result["manifest"].items()
    ]
    content_types = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    workbook = '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="词频结果" sheetId="1" r:id="rId1"/><sheet name="分析说明" sheetId="2" r:id="rId2"/></sheets></workbook>'
    rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'
    path = Path(destination)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", rels)
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml(result_rows))
        archive.writestr("xl/worksheets/sheet2.xml", sheet_xml(info_rows))
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
