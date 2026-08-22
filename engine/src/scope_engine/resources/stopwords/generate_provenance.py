"""Regenerate normalized profiles and the token-level provenance matrix."""

from __future__ import annotations

import csv
from pathlib import Path

ROOT = Path(__file__).parent
UPSTREAM = ROOT / "upstream"
PROFILES = {
    "goto456_general": "goto456-general.txt",
    "hit": "hit.txt",
    "baidu": "baidu.txt",
    "scu": "scu.txt",
}


def normalize(path: Path) -> tuple[list[str], bytes]:
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    words = sorted({line.strip() for line in lines if line.strip()})
    data = ("\n".join(words) + "\n").encode("utf-8")
    return words, data


def generate() -> dict[str, int]:
    profile_words: dict[str, list[str]] = {}
    for profile, filename in PROFILES.items():
        words, normalized = normalize(UPSTREAM / filename)
        profile_words[profile] = words
        (ROOT / filename).write_bytes(normalized)

    all_tokens = sorted(set().union(*profile_words.values()))
    with (ROOT / "provenance.tsv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, delimiter="\t", lineterminator="\n")
        writer.writerow(
            ["token", *PROFILES, "source_count", "scope_v1_included", "category", "note"]
        )
        for token in all_tokens:
            flags = [int(token in profile_words[name]) for name in PROFILES]
            included = int(token in set(normalize(ROOT / "scope-cn-general-v1.txt")[0]))
            writer.writerow(
                [
                    token,
                    *flags,
                    sum(flags),
                    included,
                    "reference",
                    "自动生成；SCOPE v1 保留/纳入需方法审查",
                ]
            )
    return {profile: len(words) for profile, words in profile_words.items()}


if __name__ == "__main__":
    print(generate())
