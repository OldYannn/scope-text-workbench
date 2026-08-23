from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scope_engine.project_store import (
    ProjectError,
    clean_batch,
    clean_execute,
    create_project,
    frequency_execute,
    frequency_latest,
    get_document,
    import_txt,
    import_user_dictionary,
    open_project,
    tokenize_batch,
    tokenize_execute,
)


class BatchWorkflowTest(unittest.TestCase):
    def create_corpus(
        self, root: Path, count: int = 3, name: str = "批处理研究"
    ) -> tuple[str, list[dict]]:
        sources = []
        for index in range(count):
            source = root / f"材料{index + 1}.txt"
            source.write_text(f"基层治理需要政策支持。第{index + 1}篇。", encoding="utf-8")
            sources.append(str(source))
        project_path = create_project(name, str(root))["project"]["project_path"]
        imported = import_txt(project_path, sources)
        return project_path, [entry["document"] for entry in imported["entries"]]

    def test_batch_clean_defaults_to_uncleaned_and_can_reprocess_all(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            project_path, documents = self.create_corpus(Path(temporary))
            clean_execute(project_path, documents[0]["document_id"], {})
            progress: list[tuple[int, int]] = []
            result = clean_batch(
                project_path,
                {},
                on_progress=lambda current, total, _message: progress.append((current, total)),
            )
            self.assertEqual(result["eligible_document_count"], 2)
            self.assertEqual(result["succeeded_count"], 2)
            self.assertEqual(progress, [(1, 2), (2, 2)])
            rerun = clean_batch(project_path, {}, reprocess_all=True)
            self.assertEqual(rerun["eligible_document_count"], 3)
            self.assertEqual(rerun["succeeded_count"], 3)
            reopened = open_project(project_path)
            self.assertEqual(reopened["project"]["cleaned_count"], 3)
            self.assertTrue(all(document["is_cleaned"] for document in reopened["documents"]))

    def test_batch_clean_preserves_partial_results_and_cancels(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            project_path, documents = self.create_corpus(Path(temporary))
            from scope_engine import project_store

            real_execute = project_store.clean_execute
            calls = 0

            def sometimes_fails(project: object, document_id: object, rules: object):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise ProjectError("fixture_failure", "deterministic failure")
                return real_execute(project, document_id, rules)

            with patch("scope_engine.project_store.clean_execute", side_effect=sometimes_fails):
                result = clean_batch(project_path, {})
            self.assertEqual(result["succeeded_count"], 2)
            self.assertEqual(result["failed_count"], 1)
            self.assertEqual(result["entries"][1]["error"]["code"], "fixture_failure")

            second_root = Path(temporary) / "第二批"
            second_root.mkdir()
            second_project, _ = self.create_corpus(second_root, 2, "取消测试")
            cancelled = False

            def stop_after_one(_current: int, _total: int, _message: str) -> None:
                nonlocal cancelled
                cancelled = True

            result = clean_batch(
                second_project,
                {},
                is_cancelled=lambda: cancelled,
                on_progress=stop_after_one,
            )
            self.assertTrue(result["cancelled"])
            self.assertEqual(result["processed_document_count"], 1)

    def test_batch_tokenize_skips_missing_analysis_text_and_invalidates_frequency(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            project_path, documents = self.create_corpus(Path(temporary), 2)
            clean_execute(project_path, documents[0]["document_id"], {})
            result = tokenize_batch(project_path, {})
            self.assertEqual(result["eligible_document_count"], 1)
            self.assertEqual(result["succeeded_count"], 1)
            self.assertEqual(result["skipped_missing_analysis_text_count"], 1)
            self.assertGreater(
                len(get_document(project_path, documents[0]["document_id"])["document"]["tokens"]),
                0,
            )
            frequency_execute(project_path)
            latest = frequency_latest(project_path)
            assert latest is not None
            self.assertTrue(latest["valid"])

            clean_execute(project_path, documents[0]["document_id"], {})
            detail = get_document(project_path, documents[0]["document_id"])["document"]
            self.assertIsNone(detail["tokens"])
            latest = frequency_latest(project_path)
            assert latest is not None
            self.assertFalse(latest["valid"])
            tokenize_execute(project_path, documents[0]["document_id"], {})
            frequency_execute(project_path)
            tokenize_batch(project_path, {}, reprocess_all=True)
            latest = frequency_latest(project_path)
            assert latest is not None
            self.assertFalse(latest["valid"])

    def test_batch_tokenize_uses_project_dictionary_and_can_cancel(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project_path, documents = self.create_corpus(root, 3)
            clean_batch(project_path, {})
            dictionary = root / "用户词典.txt"
            dictionary.write_text("基层治理需要政策支持 100 n\n", encoding="utf-8")
            imported = import_user_dictionary(project_path, str(dictionary))

            progress: list[tuple[int, int]] = []
            cancelled = False

            def stop_after_one(current: int, total: int, _message: str) -> None:
                nonlocal cancelled
                progress.append((current, total))
                cancelled = True

            result = tokenize_batch(
                project_path,
                {"dictionary_id": imported["dictionary"]["dictionary_id"]},
                is_cancelled=lambda: cancelled,
                on_progress=stop_after_one,
            )

            self.assertTrue(result["cancelled"])
            self.assertEqual(result["processed_document_count"], 1)
            self.assertEqual(progress, [(1, 3)])
            detail = get_document(project_path, documents[0]["document_id"])["document"]
            self.assertIn("基层治理需要政策支持", [item["token"] for item in detail["tokens"]])

    def test_reselecting_existing_dictionary_invalidates_mismatched_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project_path, documents = self.create_corpus(root, 2)
            clean_batch(project_path, {})
            first_dictionary = root / "词典A.txt"
            first_dictionary.write_text("基层治理需要政策支持 100 n\n", encoding="utf-8")
            second_dictionary = root / "词典B.txt"
            second_dictionary.write_text("政策支持 100 n\n", encoding="utf-8")
            first = import_user_dictionary(project_path, str(first_dictionary))["dictionary"]
            tokenize_batch(project_path, {"dictionary_id": first["dictionary_id"]})
            second = import_user_dictionary(project_path, str(second_dictionary))["dictionary"]
            tokenize_batch(project_path, {"dictionary_id": second["dictionary_id"]})
            frequency_execute(project_path)

            reselected = import_user_dictionary(project_path, str(first_dictionary))

            self.assertEqual(reselected["status"], "existing")
            self.assertEqual(reselected["invalidated_document_count"], 2)
            for document in documents:
                detail = get_document(project_path, document["document_id"])["document"]
                self.assertIsNone(detail["tokens"])
            latest = frequency_latest(project_path)
            assert latest is not None
            self.assertFalse(latest["valid"])


if __name__ == "__main__":
    unittest.main()
