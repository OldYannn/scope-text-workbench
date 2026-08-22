from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

RESOURCE_DIR = Path(__file__).with_name("resources") / "stopwords"
SCOPE_PROFILE_ID = "scope-cn-general-v1"
SCOPE_PROFILE_VERSION = "1"

PROFILE_FILES = {
    SCOPE_PROFILE_ID: "scope-cn-general-v1.txt",
    "none": None,
    "goto456-general": "goto456-general.txt",
    "hit": "hit.txt",
    "baidu": "baidu.txt",
    "scu": "scu.txt",
    "project-custom": None,
}
PROFILE_METADATA_PATH = RESOURCE_DIR / "profiles.json"
PROFILE_LABELS = {
    "none": "不使用停用词",
    "project-custom": "项目自定义",
    SCOPE_PROFILE_ID: "SCOPE 中文通用停用词表 v1",
    "goto456-general": "goto456 中文通用停用词表",
    "hit": "哈工大停用词表",
    "baidu": "百度停用词表",
    "scu": "四川大学停用词表",
}


def _read_words(filename: str | None) -> set[str]:
    if filename is None:
        return set()
    path = RESOURCE_DIR / filename
    return {
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("# SCOPE ")
    }


def available_profiles() -> list[dict[str, Any]]:
    metadata = (
        json.loads(PROFILE_METADATA_PATH.read_text(encoding="utf-8"))
        if PROFILE_METADATA_PATH.exists()
        else {}
    )
    return [
        {
            "profile_id": profile_id,
            "version": SCOPE_PROFILE_VERSION if profile_id == SCOPE_PROFILE_ID else "1",
            "label": PROFILE_LABELS[profile_id],
            "hash": resolved_hash(_read_words(filename)),
            "count": len(_read_words(filename)),
            "status": "draft" if profile_id == SCOPE_PROFILE_ID else "reference",
            "source": metadata.get(profile_id, {}),
        }
        for profile_id, filename in PROFILE_FILES.items()
    ]


def resolved_hash(words: set[str] | list[str]) -> str:
    normalized = "\n".join(sorted(set(words))) + "\n"
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def resolve_stopwords(
    base_profile_id: str = SCOPE_PROFILE_ID,
    additions: list[str] | None = None,
    exclusions: list[str] | None = None,
    extension_words: list[str] | None = None,
) -> dict[str, Any]:
    if base_profile_id not in PROFILE_FILES:
        raise ValueError(f"Unknown stopword profile: {base_profile_id}")
    base = _read_words(PROFILE_FILES[base_profile_id])
    additions_set = {word.strip() for word in (additions or []) if word.strip()}
    exclusions_set = {word.strip() for word in (exclusions or []) if word.strip()}
    extension_set = {word.strip() for word in (extension_words or []) if word.strip()}
    resolved = (base | additions_set | extension_set) - exclusions_set
    return {
        "base_profile_id": base_profile_id,
        "base_profile_version": "1",
        "base_profile_hash": resolved_hash(base),
        "extension_profiles": [],
        "custom_additions": sorted(additions_set),
        "custom_exclusions": sorted(exclusions_set),
        "resolved_stopwords": sorted(resolved),
        "resolved_stopword_hash": resolved_hash(resolved),
        "status": "draft" if base_profile_id == SCOPE_PROFILE_ID else "reference",
    }


def import_stopword_file(project_path: Path, source_path: str) -> dict[str, Any]:
    source = Path(source_path).expanduser()
    try:
        data = source.read_bytes()
        text = data.decode("utf-8-sig")
    except (OSError, UnicodeDecodeError) as error:
        raise ValueError("停用词文件必须是 UTF-8 TXT") from error
    file_hash = hashlib.sha256(data).hexdigest()
    destination = project_path / "stopwords" / f"{file_hash}.txt"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        destination.write_bytes(data)
    words = sorted({line.strip() for line in text.splitlines() if line.strip()})
    return {"path": str(destination.relative_to(project_path)), "hash": file_hash, "words": words}


def duplicate_lines(filename: str) -> list[str]:
    lines = (RESOURCE_DIR / filename).read_text(encoding="utf-8").splitlines()
    seen: set[str] = set()
    duplicates: list[str] = []
    for line in lines:
        word = line.strip()
        if word and word in seen:
            duplicates.append(word)
        seen.add(word)
    return duplicates


def is_eligible_token(token: str) -> bool:
    if not token or token.isspace():
        return False
    return any(not (char.isspace() or re.match(r"^[\W_]$", char, re.UNICODE)) for char in token)


def filter_tokens(tokens: list[dict[str, Any]], stopwords: set[str]) -> tuple[list[str], int, int]:
    eligible = [
        str(item.get("token", ""))
        for item in tokens
        if is_eligible_token(str(item.get("token", "")))
    ]
    effective = [token for token in eligible if token not in stopwords]
    return effective, len(eligible), len(effective)
