from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from scope_engine import __version__

PROJECT_FORMAT_VERSION = 1
DATABASE_SCHEMA_VERSION = 4
PROJECT_METADATA_FILENAME = "project.json"
DATABASE_FILENAME = "scope.db"
INVALID_WINDOWS_FILENAME_CHARACTERS = frozenset('<>:"/\\|?*')
RESERVED_WINDOWS_FILENAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}


class ProjectError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _validate_project_name(name: object) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ProjectError("invalid_project_name", "Project name cannot be empty")
    normalized = name.strip()
    if (
        any(character in INVALID_WINDOWS_FILENAME_CHARACTERS for character in normalized)
        or normalized.endswith((" ", "."))
        or normalized.upper().split(".", 1)[0] in RESERVED_WINDOWS_FILENAMES
    ):
        raise ProjectError(
            "invalid_project_name",
            "Project name contains characters that are not supported on Windows",
        )
    return normalized


def _write_json_atomically(path: Path, value: dict[str, Any]) -> None:
    temporary_file: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            temporary_file = Path(stream.name)
        os.replace(temporary_file, path)
    finally:
        if temporary_file is not None:
            temporary_file.unlink(missing_ok=True)


def _connect(project_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(project_path / DATABASE_FILENAME)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _initialize_database(project_path: Path) -> None:
    with _connect(project_path) as connection:
        connection.executescript(
            """
            CREATE TABLE documents (
                document_id TEXT PRIMARY KEY,
                original_filename TEXT NOT NULL,
                source_path TEXT NOT NULL,
                imported_at TEXT NOT NULL,
                text TEXT NOT NULL,
                analysis_text TEXT,
                cleaning_config_json TEXT,
                cleaning_manifest_json TEXT,
                cleaned_at TEXT,
                tokenization_manifest_json TEXT,
                tokens_json TEXT,
                character_count INTEGER NOT NULL CHECK (character_count >= 0),
                file_size INTEGER NOT NULL CHECK (file_size >= 0),
                input_hash TEXT NOT NULL UNIQUE,
                file_format TEXT NOT NULL CHECK (file_format = 'txt'),
                encoding TEXT NOT NULL,
                import_status TEXT NOT NULL CHECK (import_status IN ('imported', 'empty')),
                stored_source TEXT NOT NULL UNIQUE
            );

            CREATE TABLE audit_events (
                event_id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                manifest_json TEXT NOT NULL
            );

            CREATE TABLE user_dictionaries (
                dictionary_id TEXT PRIMARY KEY,
                original_filename TEXT NOT NULL,
                stored_path TEXT NOT NULL UNIQUE,
                imported_at TEXT NOT NULL,
                file_hash TEXT NOT NULL UNIQUE,
                file_size INTEGER NOT NULL CHECK (file_size >= 0)
            );

            CREATE TABLE stopword_profiles (
                profile_id TEXT PRIMARY KEY,
                base_profile_id TEXT NOT NULL,
                profile_json TEXT NOT NULL,
                resolved_hash TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE frequency_analyses (
                analysis_id TEXT PRIMARY KEY,
                manifest_json TEXT NOT NULL,
                result_json TEXT NOT NULL,
                result_hash TEXT NOT NULL,
                valid INTEGER NOT NULL DEFAULT 1 CHECK (valid IN (0, 1)),
                created_at TEXT NOT NULL
            );
            """
        )
        connection.execute(f"PRAGMA user_version = {DATABASE_SCHEMA_VERSION}")


def _load_metadata(project_path: Path) -> dict[str, Any]:
    metadata_path = project_path / PROJECT_METADATA_FILENAME
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ProjectError(
            "invalid_project", "The selected folder is not a readable SCOPE project"
        ) from error
    if not isinstance(metadata, dict) or metadata.get("format_version") != PROJECT_FORMAT_VERSION:
        raise ProjectError(
            "unsupported_project_version", "This SCOPE project format is not supported"
        )
    for field in ("project_id", "name", "created_at", "software_version"):
        if not isinstance(metadata.get(field), str) or not metadata[field]:
            raise ProjectError("invalid_project", "The SCOPE project metadata is incomplete")
    database_path = project_path / DATABASE_FILENAME
    if not database_path.is_file():
        raise ProjectError("invalid_project", "The SCOPE project database is missing")
    try:
        with _connect(project_path) as connection:
            schema_version = connection.execute("PRAGMA user_version").fetchone()[0]
            if schema_version == 1:
                connection.executescript(
                    """
                    ALTER TABLE documents ADD COLUMN analysis_text TEXT;
                    ALTER TABLE documents ADD COLUMN cleaning_config_json TEXT;
                    ALTER TABLE documents ADD COLUMN cleaning_manifest_json TEXT;
                    ALTER TABLE documents ADD COLUMN cleaned_at TEXT;
                    """
                )
                connection.execute("PRAGMA user_version = 2")
                connection.commit()
                schema_version = 2
            if schema_version == 2:
                connection.execute(
                    "ALTER TABLE documents ADD COLUMN tokenization_manifest_json TEXT"
                )
                connection.execute("ALTER TABLE documents ADD COLUMN tokens_json TEXT")
                connection.execute("""
                    CREATE TABLE IF NOT EXISTS user_dictionaries (
                        dictionary_id TEXT PRIMARY KEY,
                        original_filename TEXT NOT NULL,
                        stored_path TEXT NOT NULL UNIQUE,
                        imported_at TEXT NOT NULL,
                        file_hash TEXT NOT NULL UNIQUE,
                        file_size INTEGER NOT NULL CHECK (file_size >= 0)
                    )
                """)
                connection.execute("PRAGMA user_version = 3")
                connection.commit()
                schema_version = 3
            if schema_version == 3:
                connection.executescript("""
                    CREATE TABLE IF NOT EXISTS stopword_profiles (
                        profile_id TEXT PRIMARY KEY,
                        base_profile_id TEXT NOT NULL,
                        profile_json TEXT NOT NULL,
                        resolved_hash TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS frequency_analyses (
                        analysis_id TEXT PRIMARY KEY,
                        manifest_json TEXT NOT NULL,
                        result_json TEXT NOT NULL,
                        result_hash TEXT NOT NULL,
                        valid INTEGER NOT NULL DEFAULT 1 CHECK (valid IN (0, 1)),
                        created_at TEXT NOT NULL
                    );
                """)
                connection.execute(f"PRAGMA user_version = {DATABASE_SCHEMA_VERSION}")
                connection.commit()
                schema_version = DATABASE_SCHEMA_VERSION
    except sqlite3.Error as error:
        raise ProjectError(
            "invalid_project", "The SCOPE project database cannot be opened"
        ) from error
    if schema_version not in (DATABASE_SCHEMA_VERSION,):
        raise ProjectError(
            "unsupported_project_version", "This SCOPE database version is not supported"
        )
    return metadata


def _document_summary(row: sqlite3.Row) -> dict[str, Any]:
    fields = set(row.keys())
    summary = {
        "document_id": row["document_id"],
        "original_filename": row["original_filename"],
        "source_path": row["source_path"],
        "imported_at": row["imported_at"],
        "character_count": row["character_count"],
        "file_size": row["file_size"],
        "input_hash": row["input_hash"],
        "file_format": row["file_format"],
        "encoding": row["encoding"],
        "import_status": row["import_status"],
    }
    if "cleaned_at" in fields:
        summary["is_cleaned"] = row["cleaned_at"] is not None
    if "tokens_json" in fields:
        summary["is_tokenized"] = row["tokens_json"] is not None
    return summary


def _project_summary(project_path: Path, metadata: dict[str, Any]) -> dict[str, Any]:
    try:
        with _connect(project_path) as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS document_count,
                       COALESCE(SUM(character_count), 0) AS total_characters,
                       MAX(imported_at) AS last_imported_at,
                       SUM(CASE WHEN cleaned_at IS NOT NULL THEN 1 ELSE 0 END) AS cleaned_count,
                       SUM(CASE WHEN tokens_json IS NOT NULL THEN 1 ELSE 0 END) AS tokenized_count
                FROM documents
                """
            ).fetchone()
    except sqlite3.Error as error:
        raise ProjectError(
            "invalid_project", "The SCOPE project database cannot be read"
        ) from error
    return {
        "project_id": metadata["project_id"],
        "name": metadata["name"],
        "created_at": metadata["created_at"],
        "software_version": metadata["software_version"],
        "format_version": metadata["format_version"],
        "project_path": str(project_path),
        "document_count": row["document_count"],
        "total_characters": row["total_characters"],
        "last_imported_at": row["last_imported_at"],
        "cleaned_count": row["cleaned_count"] or 0,
        "tokenized_count": row["tokenized_count"] or 0,
    }


def create_project(name: object, parent_path: object) -> dict[str, Any]:
    project_name = _validate_project_name(name)
    if not isinstance(parent_path, str) or not parent_path:
        raise ProjectError("invalid_params", "parent_path must be a non-empty string")
    parent = Path(parent_path).expanduser().resolve()
    if not parent.is_dir():
        raise ProjectError(
            "project_location_unavailable", "The selected save location is unavailable"
        )
    project_path = parent / project_name
    if project_path.exists():
        raise ProjectError(
            "project_already_exists", "A folder with this project name already exists"
        )

    metadata = {
        "format_version": PROJECT_FORMAT_VERSION,
        "project_id": str(uuid.uuid4()),
        "name": project_name,
        "created_at": utc_now(),
        "software_version": __version__,
    }
    project_directory_created = False
    try:
        project_path.mkdir()
        project_directory_created = True
        (project_path / "corpus" / "original").mkdir(parents=True)
        _write_json_atomically(project_path / PROJECT_METADATA_FILENAME, metadata)
        _initialize_database(project_path)
    except (OSError, sqlite3.Error) as error:
        if project_directory_created:
            shutil.rmtree(project_path, ignore_errors=True)
        raise ProjectError(
            "project_create_failed", "The SCOPE project could not be created"
        ) from error
    return {"project": _project_summary(project_path, metadata), "documents": []}


def open_project(project_path_value: object) -> dict[str, Any]:
    if not isinstance(project_path_value, str) or not project_path_value:
        raise ProjectError("invalid_params", "project_path must be a non-empty string")
    project_path = Path(project_path_value).expanduser().resolve()
    try:
        metadata = _load_metadata(project_path)
    except ProjectError as error:
        if (
            error.code == "invalid_project"
            and not (project_path / PROJECT_METADATA_FILENAME).is_file()
        ):
            parent = project_path.parent
            try:
                parent_metadata = _load_metadata(parent)
            except ProjectError:
                pass
            else:
                raise ProjectError(
                    "project_subdirectory",
                    f"检测到上一级文件夹可能是 SCOPE 项目，请选择“{parent_metadata['name']}”项目文件夹。",
                ) from error
        raise
    try:
        with _connect(project_path) as connection:
            rows = connection.execute(
                """
                SELECT document_id, original_filename, source_path, imported_at,
                       character_count, file_size, input_hash, file_format,
                       encoding, import_status, cleaned_at, tokens_json
                FROM documents
                ORDER BY imported_at DESC, original_filename COLLATE NOCASE
                """
            ).fetchall()
    except sqlite3.Error as error:
        raise ProjectError(
            "invalid_project", "The SCOPE project database cannot be read"
        ) from error
    return {
        "project": _project_summary(project_path, metadata),
        "documents": [_document_summary(row) for row in rows],
    }


def _decode_txt(data: bytes) -> tuple[str, str]:
    encoding = "utf-8-sig" if data.startswith(b"\xef\xbb\xbf") else "utf-8"
    try:
        return data.decode(encoding, errors="strict"), encoding
    except UnicodeDecodeError as error:
        raise ProjectError(
            "unsupported_encoding",
            "The file is not valid UTF-8. Convert it to UTF-8 before importing.",
        ) from error


def _failed_entry(source_path: object, code: str, message: str) -> dict[str, Any]:
    return {
        "source_path": str(source_path),
        "status": "failed",
        "error": {"code": code, "message": message},
    }


def _import_one(
    connection: sqlite3.Connection,
    project_path: Path,
    project_id: str,
    source_value: object,
) -> dict[str, Any]:
    if not isinstance(source_value, str) or not source_value:
        return _failed_entry(source_value, "file_read_failed", "The file path is invalid")
    source = Path(source_value).expanduser()
    if source.suffix.casefold() != ".txt":
        return _failed_entry(
            source, "unsupported_format", "Only TXT files are supported in this version"
        )
    try:
        data = source.read_bytes()
    except OSError:
        return _failed_entry(source, "file_read_failed", "The file could not be read")
    try:
        text, encoding = _decode_txt(data)
    except ProjectError as error:
        return _failed_entry(source, error.code, error.message)

    input_hash = hashlib.sha256(data).hexdigest()
    duplicate = connection.execute(
        """
        SELECT document_id, original_filename, source_path, imported_at,
               character_count, file_size, input_hash, file_format,
               encoding, import_status
        FROM documents WHERE input_hash = ?
        """,
        (input_hash,),
    ).fetchone()
    if duplicate is not None:
        return {
            "source_path": str(source),
            "status": "duplicate",
            "document": _document_summary(duplicate),
        }

    document_id = str(uuid.uuid4())
    imported_at = utc_now()
    import_status = "empty" if not text else "imported"
    stored_source = f"corpus/original/{document_id}.txt"
    stored_path = project_path / stored_source
    temporary_path = stored_path.with_suffix(".tmp")
    try:
        temporary_path.write_bytes(data)
        os.replace(temporary_path, stored_path)
        connection.execute(
            """
            INSERT INTO documents (
                document_id, original_filename, source_path, imported_at, text,
                character_count, file_size, input_hash, file_format, encoding,
                import_status, stored_source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'txt', ?, ?, ?)
            """,
            (
                document_id,
                source.name,
                str(source.resolve()),
                imported_at,
                text,
                len(text),
                len(data),
                input_hash,
                encoding,
                import_status,
                stored_source,
            ),
        )
        manifest = {
            "software_version": __version__,
            "project_id": project_id,
            "document_id": document_id,
            "file_hash": input_hash,
            "imported_at": imported_at,
            "file_format": "txt",
            "encoding": encoding,
            "file_size": len(data),
            "network_used": False,
        }
        connection.execute(
            "INSERT INTO audit_events "
            "(event_id, event_type, created_at, manifest_json) "
            "VALUES (?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                "corpus.import",
                imported_at,
                json.dumps(manifest, ensure_ascii=False),
            ),
        )
        connection.commit()
    except (OSError, sqlite3.Error):
        connection.rollback()
        stored_path.unlink(missing_ok=True)
        temporary_path.unlink(missing_ok=True)
        return _failed_entry(source, "import_failed", "The file could not be saved in the project")

    row = connection.execute(
        """
        SELECT document_id, original_filename, source_path, imported_at,
               character_count, file_size, input_hash, file_format,
               encoding, import_status
        FROM documents WHERE document_id = ?
        """,
        (document_id,),
    ).fetchone()
    return {
        "source_path": str(source),
        "status": import_status,
        "document": _document_summary(row),
        "reproducibility_manifest": manifest,
    }


def import_txt(project_path_value: object, file_paths: object) -> dict[str, Any]:
    if not isinstance(project_path_value, str) or not project_path_value:
        raise ProjectError("invalid_params", "project_path must be a non-empty string")
    if not isinstance(file_paths, list) or not file_paths:
        raise ProjectError("invalid_params", "file_paths must be a non-empty list")
    project_path = Path(project_path_value).expanduser().resolve()
    metadata = _load_metadata(project_path)
    try:
        with _connect(project_path) as connection:
            entries = [
                _import_one(connection, project_path, metadata["project_id"], source)
                for source in file_paths
            ]
    except sqlite3.Error as error:
        raise ProjectError(
            "invalid_project", "The SCOPE project database cannot be read"
        ) from error
    return {"project": _project_summary(project_path, metadata), "entries": entries}


def get_document(project_path_value: object, document_id: object) -> dict[str, Any]:
    if not isinstance(project_path_value, str) or not project_path_value:
        raise ProjectError("invalid_params", "project_path must be a non-empty string")
    if not isinstance(document_id, str) or not document_id:
        raise ProjectError("invalid_params", "document_id must be a non-empty string")
    project_path = Path(project_path_value).expanduser().resolve()
    _load_metadata(project_path)
    try:
        with _connect(project_path) as connection:
            row = connection.execute(
                """
                SELECT document_id, original_filename, source_path, imported_at,
                       text, analysis_text, cleaning_config_json, cleaning_manifest_json,
                       cleaned_at, tokenization_manifest_json, tokens_json,
                       character_count, file_size, input_hash, file_format,
                       encoding, import_status
                FROM documents WHERE document_id = ?
                """,
                (document_id,),
            ).fetchone()
    except sqlite3.Error as error:
        raise ProjectError(
            "invalid_project", "The SCOPE project database cannot be read"
        ) from error
    if row is None:
        raise ProjectError("document_not_found", "The selected document is not in this project")
    document = _document_summary(row)
    document["text"] = row["text"]
    document["analysis_text"] = row["analysis_text"]
    document["cleaning_config"] = (
        json.loads(row["cleaning_config_json"]) if row["cleaning_config_json"] else None
    )
    document["cleaning_manifest"] = (
        json.loads(row["cleaning_manifest_json"]) if row["cleaning_manifest_json"] else None
    )
    document["cleaned_at"] = row["cleaned_at"]
    document["tokenization_manifest"] = (
        json.loads(row["tokenization_manifest_json"]) if row["tokenization_manifest_json"] else None
    )
    document["tokens"] = json.loads(row["tokens_json"]) if row["tokens_json"] else None
    return {"document": document}


CLEANING_IMPLEMENTATION_VERSION = "1"
DEFAULT_CLEANING_RULES = {
    "normalize_whitespace": True,
    "normalize_newlines": True,
    "remove_urls": True,
    "strip_html": True,
    "punctuation_mode": "keep",
}
URL_PATTERN = re.compile(r"https?://[^\s<>]+|www\.[^\s<>]+", re.IGNORECASE)
HTML_TAG_PATTERN = re.compile(r"<[^>]*>")


def _clean_text(text: str, rules: dict[str, Any]) -> str:
    config = {**DEFAULT_CLEANING_RULES, **rules}
    value = text.replace("\r\n", "\n").replace("\r", "\n") if config["normalize_newlines"] else text
    if config["strip_html"]:
        value = HTML_TAG_PATTERN.sub("", value)
    if config["remove_urls"]:
        value = URL_PATTERN.sub("", value)
    if config["normalize_whitespace"]:
        value = re.sub(r"[ \t\f\v]+", " ", value)
        value = re.sub(r" *\n *", "\n", value)
        value = value.strip()
    if config.get("punctuation_mode") == "remove":
        import unicodedata

        value = "".join(char for char in value if not unicodedata.category(char).startswith("P"))
    return value


def clean_preview(project_path_value: object, document_id: object, rules: object) -> dict[str, Any]:
    if not isinstance(rules, dict):
        raise ProjectError("invalid_params", "clean.preview requires a rules object")
    project_path = Path(str(project_path_value)).expanduser().resolve()
    _load_metadata(project_path)
    with _connect(project_path) as connection:
        row = connection.execute(
            "SELECT text, input_hash FROM documents WHERE document_id = ?", (document_id,)
        ).fetchone()
    if row is None:
        raise ProjectError("document_not_found", "The selected document is not in this project")
    normalized_rules = {**DEFAULT_CLEANING_RULES, **rules}
    cleaned = _clean_text(row["text"], normalized_rules)
    return {
        "original_text": row["text"],
        "analysis_text": cleaned,
        "rules": normalized_rules,
        "input_hash": row["input_hash"],
        "implementation_version": CLEANING_IMPLEMENTATION_VERSION,
    }


def clean_execute(project_path_value: object, document_id: object, rules: object) -> dict[str, Any]:
    preview = clean_preview(project_path_value, document_id, rules)
    project_path = Path(str(project_path_value)).expanduser().resolve()
    cleaned_at = utc_now()
    manifest = {
        "operation": "text.clean",
        "implementation_version": CLEANING_IMPLEMENTATION_VERSION,
        "input_hashes": [preview["input_hash"]],
        "rules": preview["rules"],
        "parameters": {},
        "executed_at": cleaned_at,
        "network_used": False,
        "original_analysis_relation": "analysis_text is derived from immutable original text",
    }
    with _connect(project_path) as connection:
        connection.execute(
            "UPDATE documents SET analysis_text = ?, cleaning_config_json = ?, cleaning_manifest_json = ?, cleaned_at = ?, tokens_json = NULL, tokenization_manifest_json = NULL WHERE document_id = ?",
            (
                preview["analysis_text"],
                json.dumps(preview["rules"], ensure_ascii=False),
                json.dumps(manifest, ensure_ascii=False),
                cleaned_at,
                document_id,
            ),
        )
        connection.execute(
            "INSERT INTO audit_events (event_id, event_type, created_at, manifest_json) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), "text.clean", cleaned_at, json.dumps(manifest, ensure_ascii=False)),
        )
        connection.execute("UPDATE frequency_analyses SET valid = 0")
        connection.commit()
    return {**preview, "cleaned_at": cleaned_at, "cleaning_manifest": manifest}


def clean_batch(
    project_path_value: object,
    rules: object,
    *,
    reprocess_all: bool = False,
    is_cancelled: Callable[[], bool] | None = None,
    on_progress: Callable[[int, int, str], None] | None = None,
) -> dict[str, Any]:
    if not isinstance(rules, dict) or not isinstance(reprocess_all, bool):
        raise ProjectError("invalid_params", "batch cleaning requires rules and reprocess_all")
    project_path = Path(str(project_path_value)).expanduser().resolve()
    _load_metadata(project_path)
    with _connect(project_path) as connection:
        rows = connection.execute(
            "SELECT document_id, original_filename, cleaned_at FROM documents ORDER BY imported_at, document_id"
        ).fetchall()
    eligible = [row for row in rows if reprocess_all or row["cleaned_at"] is None]
    entries: list[dict[str, Any]] = []
    total = len(eligible)
    for current, row in enumerate(eligible, 1):
        if is_cancelled and is_cancelled():
            break
        try:
            result = clean_execute(str(project_path), row["document_id"], rules)
        except ProjectError as error:
            entries.append(
                {
                    "document_id": row["document_id"],
                    "filename": row["original_filename"],
                    "status": "failed",
                    "error": {"code": error.code, "message": error.message},
                }
            )
        else:
            entries.append(
                {
                    "document_id": row["document_id"],
                    "filename": row["original_filename"],
                    "status": "succeeded",
                    "cleaned_at": result["cleaned_at"],
                }
            )
        if on_progress:
            on_progress(current, total, f"正在清洗 {current} / {total} 篇文档")
    succeeded = sum(entry["status"] == "succeeded" for entry in entries)
    failed = len(entries) - succeeded
    return {
        "operation": "text.clean.batch",
        "total_document_count": len(rows),
        "eligible_document_count": total,
        "processed_document_count": len(entries),
        "succeeded_count": succeeded,
        "failed_count": failed,
        "cancelled": len(entries) < total,
        "entries": entries,
        "project": _project_summary(project_path, _load_metadata(project_path)),
    }


TOKENIZATION_IMPLEMENTATION_VERSION = "1"
TOKENIZER_ENGINE = "jieba"
TOKENIZER_VERSION = "0.42.1"
DEFAULT_TOKENIZATION_CONFIG = {"mode": "accurate", "hmm": True, "dictionary_id": None}


def _dictionary_summary(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "dictionary_id": row["dictionary_id"],
        "name": row["original_filename"],
        "hash": row["file_hash"],
        "file_size": row["file_size"],
        "imported_at": row["imported_at"],
    }


def import_user_dictionary(project_path_value: object, source_value: object) -> dict[str, Any]:
    if (
        not isinstance(project_path_value, str)
        or not isinstance(source_value, str)
        or not source_value
    ):
        raise ProjectError(
            "invalid_params", "user dictionary import requires project_path and file_path"
        )
    project_path = Path(project_path_value).expanduser().resolve()
    metadata = _load_metadata(project_path)
    source = Path(source_value).expanduser()
    try:
        data = source.read_bytes()
        data.decode("utf-8-sig")
    except (OSError, UnicodeDecodeError) as error:
        raise ProjectError("dictionary_read_failed", "用户词典必须是可读取的 UTF-8 文本") from error
    file_hash = hashlib.sha256(data).hexdigest()
    with _connect(project_path) as connection:
        duplicate = connection.execute(
            "SELECT * FROM user_dictionaries WHERE file_hash = ?", (file_hash,)
        ).fetchone()
        if duplicate is not None:
            invalidated_document_count = 0
            tokenized_rows = connection.execute(
                "SELECT document_id, tokenization_manifest_json FROM documents "
                "WHERE tokens_json IS NOT NULL"
            ).fetchall()
            for document in tokenized_rows:
                manifest = json.loads(document["tokenization_manifest_json"] or "{}")
                if manifest.get("user_dictionary_id") == duplicate["dictionary_id"]:
                    continue
                connection.execute(
                    "UPDATE documents SET tokens_json = NULL, tokenization_manifest_json = NULL "
                    "WHERE document_id = ?",
                    (document["document_id"],),
                )
                invalidated_document_count += 1
            if invalidated_document_count:
                connection.execute("UPDATE frequency_analyses SET valid = 0")
            connection.commit()
            return {
                "dictionary": _dictionary_summary(duplicate),
                "status": "existing",
                "invalidated_document_count": invalidated_document_count,
            }
        dictionary_id = str(uuid.uuid4())
        stored_path = f"dictionaries/{dictionary_id}.txt"
        stored = project_path / stored_path
        stored.parent.mkdir(parents=True, exist_ok=True)
        stored.write_bytes(data)
        imported_at = utc_now()
        connection.execute(
            "INSERT INTO user_dictionaries VALUES (?, ?, ?, ?, ?, ?)",
            (dictionary_id, source.name, stored_path, imported_at, file_hash, len(data)),
        )
        # A changed dictionary invalidates prior token results; they must be rerun explicitly.
        connection.execute(
            "UPDATE documents SET tokens_json = NULL, tokenization_manifest_json = NULL"
        )
        connection.execute("UPDATE frequency_analyses SET valid = 0")
        manifest = {
            "operation": "tokenization.dictionary_import",
            "project_id": metadata["project_id"],
            "dictionary_id": dictionary_id,
            "file_hash": file_hash,
            "imported_at": imported_at,
            "network_used": False,
        }
        connection.execute(
            "INSERT INTO audit_events VALUES (?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                "tokenization.dictionary_import",
                imported_at,
                json.dumps(manifest, ensure_ascii=False),
            ),
        )
        connection.commit()
        row = connection.execute(
            "SELECT * FROM user_dictionaries WHERE dictionary_id = ?", (dictionary_id,)
        ).fetchone()
    return {
        "dictionary": _dictionary_summary(row),
        "status": "imported",
        "reproducibility_manifest": manifest,
    }


def _load_dictionary(project_path: Path, connection: sqlite3.Connection, dictionary_id: object):
    if dictionary_id is None:
        return None, None
    if not isinstance(dictionary_id, str) or not dictionary_id:
        raise ProjectError("invalid_params", "dictionary_id must be a string or null")
    row = connection.execute(
        "SELECT * FROM user_dictionaries WHERE dictionary_id = ?", (dictionary_id,)
    ).fetchone()
    if row is None:
        raise ProjectError("dictionary_not_found", "项目中找不到该用户词典")
    return project_path / row["stored_path"], row


def _tokenize(
    text: str, config: dict[str, Any], dictionary_path: Path | None
) -> list[dict[str, Any]]:
    import jieba  # type: ignore[import-untyped]

    tokenizer = jieba.Tokenizer()
    if dictionary_path is not None:
        tokenizer.load_userdict(str(dictionary_path))
    return [
        {"index": index, "token": token}
        for index, token in enumerate(tokenizer.cut(text, HMM=bool(config["hmm"])))
        if token
    ]


def tokenize_preview(
    project_path_value: object, document_id: object, config: object
) -> dict[str, Any]:
    if not isinstance(config, dict):
        raise ProjectError("invalid_params", "tokenization requires a config object")
    project_path = Path(str(project_path_value)).expanduser().resolve()
    _load_metadata(project_path)
    normalized = {**DEFAULT_TOKENIZATION_CONFIG, **config}
    if normalized.get("mode") != "accurate":
        raise ProjectError("unsupported_tokenization_mode", "当前版本只支持标准分词（精确模式）")
    with _connect(project_path) as connection:
        row = connection.execute(
            "SELECT analysis_text, input_hash FROM documents WHERE document_id = ?", (document_id,)
        ).fetchone()
        if row is None:
            raise ProjectError("document_not_found", "项目中找不到这篇文档")
        if row["analysis_text"] is None:
            raise ProjectError("analysis_text_missing", "该文档尚未生成分析文本，请先执行文本清洗")
        dictionary_path, dictionary_row = _load_dictionary(
            project_path, connection, normalized.get("dictionary_id")
        )
        tokens = _tokenize(row["analysis_text"], normalized, dictionary_path)
    dictionary_hash = dictionary_row["file_hash"] if dictionary_row else None
    manifest = {
        "engine": TOKENIZER_ENGINE,
        "engine_version": TOKENIZER_VERSION,
        "mode": "accurate",
        "hmm": bool(normalized["hmm"]),
        "input_analysis_text_hash": hashlib.sha256(
            row["analysis_text"].encode("utf-8")
        ).hexdigest(),
        "default_dictionary": {"identity": "jieba-default", "version": TOKENIZER_VERSION},
        "user_dictionary": dictionary_row["original_filename"] if dictionary_row else "none",
        "user_dictionary_id": dictionary_row["dictionary_id"] if dictionary_row else None,
        "user_dictionary_hash": dictionary_hash,
        "tokenization_implementation_version": TOKENIZATION_IMPLEMENTATION_VERSION,
        "executed_at": utc_now(),
        "network_used": False,
    }
    return {"tokens": tokens, "manifest": manifest, "config": normalized}


def tokenize_execute(
    project_path_value: object, document_id: object, config: object
) -> dict[str, Any]:
    preview = tokenize_preview(project_path_value, document_id, config)
    project_path = Path(str(project_path_value)).expanduser().resolve()
    executed_at = preview["manifest"]["executed_at"]
    manifest = preview["manifest"]
    manifest["executed_at"] = executed_at
    with _connect(project_path) as connection:
        connection.execute(
            "UPDATE documents SET tokens_json = ?, tokenization_manifest_json = ? WHERE document_id = ?",
            (
                json.dumps(preview["tokens"], ensure_ascii=False),
                json.dumps(manifest, ensure_ascii=False),
                document_id,
            ),
        )
        connection.execute(
            "INSERT INTO audit_events VALUES (?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                "text.tokenize",
                executed_at,
                json.dumps(manifest, ensure_ascii=False),
            ),
        )
        connection.execute("UPDATE frequency_analyses SET valid = 0")
        connection.commit()
    return {**preview, "executed_at": executed_at}


def tokenize_batch(
    project_path_value: object,
    config: object,
    *,
    reprocess_all: bool = False,
    is_cancelled: Callable[[], bool] | None = None,
    on_progress: Callable[[int, int, str], None] | None = None,
) -> dict[str, Any]:
    if not isinstance(config, dict) or not isinstance(reprocess_all, bool):
        raise ProjectError("invalid_params", "batch tokenization requires config and reprocess_all")
    project_path = Path(str(project_path_value)).expanduser().resolve()
    _load_metadata(project_path)
    with _connect(project_path) as connection:
        rows = connection.execute(
            "SELECT document_id, original_filename, analysis_text, tokens_json FROM documents ORDER BY imported_at, document_id"
        ).fetchall()
    eligible = [
        row
        for row in rows
        if row["analysis_text"] is not None and (reprocess_all or row["tokens_json"] is None)
    ]
    skipped_missing = [row["document_id"] for row in rows if row["analysis_text"] is None]
    entries: list[dict[str, Any]] = []
    total = len(eligible)
    for current, row in enumerate(eligible, 1):
        if is_cancelled and is_cancelled():
            break
        try:
            result = tokenize_execute(str(project_path), row["document_id"], config)
        except ProjectError as error:
            entries.append(
                {
                    "document_id": row["document_id"],
                    "filename": row["original_filename"],
                    "status": "failed",
                    "error": {"code": error.code, "message": error.message},
                }
            )
        else:
            entries.append(
                {
                    "document_id": row["document_id"],
                    "filename": row["original_filename"],
                    "status": "succeeded",
                    "token_count": len(result["tokens"]),
                }
            )
        if on_progress:
            on_progress(current, total, f"正在分词 {current} / {total} 篇文档")
    succeeded = sum(entry["status"] == "succeeded" for entry in entries)
    failed = len(entries) - succeeded
    return {
        "operation": "text.tokenize.batch",
        "total_document_count": len(rows),
        "eligible_document_count": total,
        "processed_document_count": len(entries),
        "succeeded_count": succeeded,
        "failed_count": failed,
        "skipped_missing_analysis_text_count": len(skipped_missing),
        "skipped_missing_analysis_text_ids": skipped_missing,
        "cancelled": len(entries) < total,
        "entries": entries,
        "project": _project_summary(project_path, _load_metadata(project_path)),
    }


def get_stopword_profiles() -> list[dict[str, Any]]:
    from .stopwords import available_profiles

    return available_profiles()


def resolve_project_stopwords(
    project_path_value: object,
    *,
    base_profile_id: str = "scope-cn-general-v1",
    additions: list[str] | None = None,
    exclusions: list[str] | None = None,
    extension_words: list[str] | None = None,
) -> dict[str, Any]:
    from .stopwords import resolve_stopwords

    if not isinstance(project_path_value, str) or not project_path_value:
        raise ProjectError("invalid_params", "project_path must be a non-empty string")
    project_path = Path(project_path_value).expanduser().resolve()
    _load_metadata(project_path)
    try:
        profile = resolve_stopwords(base_profile_id, additions, exclusions, extension_words)
    except ValueError as error:
        raise ProjectError("invalid_params", str(error)) from error
    updated_at = utc_now()
    with _connect(project_path) as connection:
        connection.execute(
            "INSERT OR REPLACE INTO stopword_profiles VALUES (?, ?, ?, ?, ?)",
            (
                "active",
                profile["base_profile_id"],
                json.dumps(profile, ensure_ascii=False),
                profile["resolved_stopword_hash"],
                updated_at,
            ),
        )
        connection.execute("UPDATE frequency_analyses SET valid = 0")
        manifest = {
            "operation": "stopwords.resolve",
            "profile": profile,
            "executed_at": updated_at,
            "network_used": False,
        }
        connection.execute(
            "INSERT INTO audit_events VALUES (?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                "stopwords.resolve",
                updated_at,
                json.dumps(manifest, ensure_ascii=False),
            ),
        )
        connection.commit()
    return profile


def get_project_stopwords(project_path_value: object) -> dict[str, Any]:
    from .stopwords import resolve_stopwords

    project_path = Path(str(project_path_value)).expanduser().resolve()
    _load_metadata(project_path)
    with _connect(project_path) as connection:
        row = connection.execute(
            "SELECT profile_json FROM stopword_profiles WHERE profile_id = 'active'"
        ).fetchone()
    return json.loads(row["profile_json"]) if row else resolve_stopwords()


def import_project_stopwords(project_path_value: object, source_path: object) -> dict[str, Any]:
    if not isinstance(project_path_value, str) or not isinstance(source_path, str):
        raise ProjectError("invalid_params", "stopword import requires project_path and file_path")
    from .stopwords import import_stopword_file

    project_path = Path(project_path_value).expanduser().resolve()
    _load_metadata(project_path)
    try:
        imported = import_stopword_file(project_path, source_path)
    except ValueError as error:
        raise ProjectError("stopword_read_failed", str(error)) from error
    return imported


def _frequency_documents(project_path: Path) -> list[dict[str, Any]]:
    with _connect(project_path) as connection:
        rows = connection.execute(
            "SELECT document_id, tokens_json, tokenization_manifest_json FROM documents ORDER BY imported_at"
        ).fetchall()
    return [
        {
            "document_id": row["document_id"],
            "tokens": json.loads(row["tokens_json"]) if row["tokens_json"] else None,
            "tokenization_manifest": json.loads(row["tokenization_manifest_json"])
            if row["tokenization_manifest_json"]
            else None,
        }
        for row in rows
    ]


def frequency_execute(
    project_path_value: object, profile_config: dict[str, Any] | None = None
) -> dict[str, Any]:
    from .frequency import analyze_documents, result_hash

    if not isinstance(project_path_value, str) or not project_path_value:
        raise ProjectError("invalid_params", "project_path must be a non-empty string")
    project_path = Path(project_path_value).expanduser().resolve()
    metadata = _load_metadata(project_path)
    if profile_config is not None:
        resolve_project_stopwords(
            str(project_path),
            base_profile_id=profile_config.get("base_profile_id", "scope-cn-general-v1"),
            additions=profile_config.get("custom_additions", []),
            exclusions=profile_config.get("custom_exclusions", []),
            extension_words=profile_config.get("extension_words", []),
        )
    analysis_id = str(uuid.uuid4())
    result = analyze_documents(
        _frequency_documents(project_path),
        get_project_stopwords(project_path),
        analysis_id=analysis_id,
    )
    result["manifest"]["project_id"] = metadata["project_id"]
    result["manifest"]["project_name"] = metadata["name"]
    digest = result_hash(result)
    with _connect(project_path) as connection:
        connection.execute(
            "INSERT INTO frequency_analyses VALUES (?, ?, ?, ?, 1, ?)",
            (
                analysis_id,
                json.dumps(result["manifest"], ensure_ascii=False),
                json.dumps(result["rows"], ensure_ascii=False),
                digest,
                result["manifest"]["executed_at"],
            ),
        )
        connection.execute(
            "INSERT INTO audit_events VALUES (?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                "frequency.analyze",
                result["manifest"]["executed_at"],
                json.dumps(result["manifest"], ensure_ascii=False),
            ),
        )
        connection.commit()
    return {**result, "analysis_id": analysis_id, "result_hash": digest}


def frequency_latest(project_path_value: object) -> dict[str, Any] | None:
    project_path = Path(str(project_path_value)).expanduser().resolve()
    _load_metadata(project_path)
    with _connect(project_path) as connection:
        row = connection.execute(
            "SELECT * FROM frequency_analyses ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
    if row is None:
        return None
    return {
        "analysis_id": row["analysis_id"],
        "manifest": json.loads(row["manifest_json"]),
        "rows": json.loads(row["result_json"]),
        "result_hash": row["result_hash"],
        "valid": bool(row["valid"]),
    }


def frequency_export(
    project_path_value: object, destination: object, format_name: object
) -> dict[str, Any]:
    from .frequency import export_csv, export_xlsx

    if (
        not isinstance(project_path_value, str)
        or not isinstance(destination, str)
        or format_name not in ("csv", "xlsx")
    ):
        raise ProjectError(
            "invalid_params",
            "frequency export requires project_path, destination, and csv/xlsx format",
        )
    latest = frequency_latest(project_path_value)
    if latest is None or not latest["valid"]:
        raise ProjectError("frequency_not_available", "没有可导出的有效词频分析，请先重新计算")
    result = {"rows": latest["rows"], "manifest": latest["manifest"]}
    path = (
        export_csv(result, destination)
        if format_name == "csv"
        else export_xlsx(result, destination)
    )
    return {
        "path": str(path),
        "analysis_id": latest["analysis_id"],
        "result_hash": latest["result_hash"],
    }
