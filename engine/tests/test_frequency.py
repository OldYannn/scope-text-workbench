from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scope_engine.frequency import (
    analyze_documents,
    export_csv,
    export_xlsx,
    optimization_candidates,
)
from scope_engine.stopwords import is_eligible_token, resolve_stopwords


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


if __name__ == "__main__":
    unittest.main()
