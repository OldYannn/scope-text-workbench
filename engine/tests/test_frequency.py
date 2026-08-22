from __future__ import annotations

import hashlib
import json
import runpy
import tempfile
import unittest
from pathlib import Path

from scope_engine.frequency import (
    analyze_documents,
    export_csv,
    export_xlsx,
    optimization_candidates,
)
from scope_engine.stopwords import (
    available_profiles,
    duplicate_lines,
    is_eligible_token,
    resolve_stopwords,
)


class FrequencyAnalysisTest(unittest.TestCase):
    def fixture(self):
        return [
            {
                "document_id": "doc-a",
                "tokens": [{"token": token} for token in ["的", "党", "目的地", "1", "，", "党"]],
            },
            {
                "document_id": "doc-b",
                "tokens": [{"token": token} for token in ["的", "党", "政策"]],
            },
            {"document_id": "doc-c", "tokens": None},
        ]

    def test_exact_matching_and_eligibility(self):
        result = analyze_documents(self.fixture())
        self.assertEqual([row["token"] for row in result["rows"]], ["党", "1", "政策", "目的地"])
        self.assertEqual(result["manifest"]["raw_token_count"], 9)
        self.assertEqual(result["manifest"]["eligible_token_count"], 8)
        self.assertEqual(result["manifest"]["effective_token_count"], 6)
        self.assertEqual(next(row for row in result["rows"] if row["token"] == "党")["df"], 2)
        self.assertTrue(is_eligible_token("单"))
        self.assertTrue(is_eligible_token("1"))
        self.assertFalse(is_eligible_token("，"))

    def test_profile_layering_and_stable_hash(self):
        first = resolve_stopwords(additions=["项目词"], exclusions=["的"])
        second = resolve_stopwords(additions=["项目词"], exclusions=["的"])
        self.assertIn("项目词", first["resolved_stopwords"])
        self.assertNotIn("的", first["resolved_stopwords"])
        self.assertEqual(first["resolved_stopword_hash"], second["resolved_stopword_hash"])
        self.assertIn("党", "党")

    def test_candidates_and_exports(self):
        result = analyze_documents(self.fixture())
        candidates = optimization_candidates(result, coverage_threshold=0.5)
        self.assertEqual(candidates[0]["token"], "党")
        with tempfile.TemporaryDirectory() as directory:
            csv_path = export_csv(result, Path(directory) / "词频.csv")
            self.assertTrue(csv_path.read_bytes().startswith(b"\xef\xbb\xbf"))
            xlsx_path = export_xlsx(result, Path(directory) / "词频.xlsx")
            self.assertTrue(xlsx_path.read_bytes().startswith(b"PK"))

    def test_upstream_snapshots_and_provenance_are_deterministic(self):
        root = Path(__file__).parents[1] / "src" / "scope_engine" / "resources" / "stopwords"
        expected_counts = {
            "goto456-general.txt": 746,
            "hit.txt": 749,
            "baidu.txt": 1395,
            "scu.txt": 860,
        }
        metadata = json.loads((root / "profiles.json").read_text(encoding="utf-8"))
        expected_raw_hashes = {
            "goto456-general.txt": "5c8d5dd24906615de61ae4056f9261b6fb9f42f58bc75f442fe1032b511dc04b",
            "hit.txt": "84e526454db0245cab0d167df067f00298d271ad2c86391d45f5e880c422cbae",
            "baidu.txt": "b11ff810ee5c8934dc46b57f3a1ba85457e3893e89acdafb5cd286570fe793a3",
            "scu.txt": "2c325256276f2c4ed5ec076178c08494af7a46bf44d0b9be2fc0214d5b606d41",
        }
        expected_raw_duplicates = {
            "goto456-general.txt": 0,
            "hit.txt": 18,
            "baidu.txt": 0,
            "scu.txt": 116,
        }
        for filename, count in expected_counts.items():
            words = (root / filename).read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(words), count)
            self.assertEqual(words, sorted(set(words)))
            self.assertFalse(duplicate_lines(filename))
            raw = (root / "upstream" / filename).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), expected_raw_hashes[filename])
            key = filename.removesuffix(".txt")
            self.assertEqual(metadata[key]["raw_sha256"], expected_raw_hashes[filename])
            self.assertEqual(metadata[key]["unique_token_count"], count)
            raw_words = [line.strip() for line in raw.decode("utf-8-sig").splitlines()]
            self.assertEqual(len(raw_words), metadata[key]["raw_line_count"])
            self.assertEqual(
                len(raw_words) - len(set(raw_words)), expected_raw_duplicates[filename]
            )
        with (root / "provenance.tsv").open(encoding="utf-8") as provenance:
            self.assertEqual(sum(1 for _ in provenance) - 1, 2312)
        before = (root / "provenance.tsv").read_bytes()
        runpy.run_path(str(root / "generate_provenance.py"), run_name="__main__")
        self.assertEqual(before, (root / "provenance.tsv").read_bytes())
        scope = next(
            item for item in available_profiles() if item["profile_id"] == "scope-cn-general-v1"
        )
        self.assertEqual(scope["status"], "draft")


if __name__ == "__main__":
    unittest.main()
