from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from scope_engine import __version__

PROJECT_FORMAT_VERSION = 1
DATABASE_SCHEMA_VERSION = 2
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
    return {
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


def _project_summary(project_path: Path, metadata: dict[str, Any]) -> dict[str, Any]:
    try:
        with _connect(project_path) as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS document_count,
                       COALESCE(SUM(character_count), 0) AS total_characters,
                       MAX(imported_at) AS last_imported_at
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
        if error.code == "invalid_project" and not (project_path / PROJECT_METADATA_FILENAME).is_file():
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
                       encoding, import_status
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
                       cleaned_at, character_count, file_size, input_hash, file_format,
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
    document["cleaning_config"] = json.loads(row["cleaning_config_json"]) if row["cleaning_config_json"] else None
    document["cleaning_manifest"] = json.loads(row["cleaning_manifest_json"]) if row["cleaning_manifest_json"] else None
    document["cleaned_at"] = row["cleaned_at"]
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
        row = connection.execute("SELECT text, input_hash FROM documents WHERE document_id = ?", (document_id,)).fetchone()
    if row is None:
        raise ProjectError("document_not_found", "The selected document is not in this project")
    normalized_rules = {**DEFAULT_CLEANING_RULES, **rules}
    cleaned = _clean_text(row["text"], normalized_rules)
    return {"original_text": row["text"], "analysis_text": cleaned, "rules": normalized_rules,
            "input_hash": row["input_hash"], "implementation_version": CLEANING_IMPLEMENTATION_VERSION}


def clean_execute(project_path_value: object, document_id: object, rules: object) -> dict[str, Any]:
    preview = clean_preview(project_path_value, document_id, rules)
    project_path = Path(str(project_path_value)).expanduser().resolve()
    cleaned_at = utc_now()
    manifest = {"operation": "text.clean", "implementation_version": CLEANING_IMPLEMENTATION_VERSION,
                "input_hashes": [preview["input_hash"]], "rules": preview["rules"],
                "parameters": {}, "executed_at": cleaned_at, "network_used": False,
                "original_analysis_relation": "analysis_text is derived from immutable original text"}
    with _connect(project_path) as connection:
        connection.execute("UPDATE documents SET analysis_text = ?, cleaning_config_json = ?, cleaning_manifest_json = ?, cleaned_at = ? WHERE document_id = ?",
                           (preview["analysis_text"], json.dumps(preview["rules"], ensure_ascii=False), json.dumps(manifest, ensure_ascii=False), cleaned_at, document_id))
        connection.execute("INSERT INTO audit_events (event_id, event_type, created_at, manifest_json) VALUES (?, ?, ?, ?)",
                           (str(uuid.uuid4()), "text.clean", cleaned_at, json.dumps(manifest, ensure_ascii=False)))
        connection.commit()
    return {**preview, "cleaned_at": cleaned_at, "cleaning_manifest": manifest}
