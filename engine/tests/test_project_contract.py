from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from test_cli_contract import invoke_engine

from scope_engine.project_store import ProjectError, create_project

FIXTURES = Path(__file__).parent / "fixtures" / "corpus"


def request(method: str, params: dict[str, Any], request_id: str) -> dict[str, Any]:
    completed = invoke_engine(
        json.dumps(
            {
                "protocol_version": "0.1",
                "request_id": request_id,
                "method": method,
                "params": params,
            },
            ensure_ascii=False,
        )
    )
    if completed.returncode != 0:
        raise AssertionError(completed.stderr)
    return json.loads(completed.stdout)


class ProjectProtocolContractTest(unittest.TestCase):
    def create_project(self, parent: Path, name: str = "访谈研究") -> dict[str, Any]:
        response = request(
            "project.create",
            {"name": name, "parent_path": str(parent)},
            "create-project",
        )
        self.assertEqual(response["type"], "result", response)
        return response["result"]

    def test_project_is_saved_and_can_be_reopened(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            result = self.create_project(Path(temporary_directory))
            project = result["project"]
            project_path = Path(project["project_path"])

            self.assertTrue((project_path / "project.json").is_file())
            self.assertTrue((project_path / "scope.db").is_file())
            self.assertTrue((project_path / "corpus" / "original").is_dir())
            self.assertEqual(project["name"], "访谈研究")
            self.assertEqual(project["document_count"], 0)
            self.assertEqual(project["total_characters"], 0)
            self.assertRegex(project["project_id"], r"^[0-9a-f-]{36}$")

            reopened = request(
                "project.open",
                {"project_path": str(project_path), "future_display_hint": "ignored"},
                "open-project",
            )

            self.assertEqual(reopened["type"], "result", reopened)
            self.assertEqual(reopened["result"]["project"], project)
            self.assertEqual(reopened["result"]["documents"], [])

            moved_parent = Path(temporary_directory) / "备份位置"
            moved_parent.mkdir()
            moved_path = moved_parent / project_path.name
            shutil.move(project_path, moved_path)
            moved = request(
                "project.open",
                {"project_path": str(moved_path)},
                "open-moved-project",
            )
            self.assertEqual(moved["type"], "result", moved)
            self.assertEqual(moved["result"]["project"]["project_id"], project["project_id"])
            self.assertEqual(moved["result"]["project"]["project_path"], str(moved_path.resolve()))

    def test_create_race_does_not_delete_an_independently_created_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            parent = Path(temporary_directory)
            existing_project = parent / "并发创建项目"
            existing_project.mkdir()
            sentinel = existing_project / "不得删除.txt"
            sentinel.write_text("用户数据", encoding="utf-8")

            with (
                patch.object(Path, "exists", return_value=False),
                self.assertRaises(ProjectError) as raised,
            ):
                create_project("并发创建项目", str(parent))

            self.assertEqual(raised.exception.code, "project_create_failed")
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "用户数据")

    def test_imports_utf8_bom_empty_chinese_paths_and_reopens_documents(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            parent = Path(temporary_directory) / "中文项目目录"
            parent.mkdir()
            project = self.create_project(parent)["project"]
            project_path = project["project_path"]
            empty_file = parent / "空文件.txt"
            empty_file.touch()

            imported = request(
                "corpus.import_txt",
                {
                    "project_path": project_path,
                    "file_paths": [
                        str(FIXTURES / "正常中文.txt"),
                        str(FIXTURES / "BOM中文.txt"),
                        str(empty_file),
                    ],
                },
                "import-files",
            )

            self.assertEqual(imported["type"], "result", imported)
            entries = imported["result"]["entries"]
            self.assertEqual(
                [entry["status"] for entry in entries], ["imported", "imported", "empty"]
            )
            by_name = {
                entry["document"]["original_filename"]: entry["document"] for entry in entries
            }
            self.assertEqual(by_name["正常中文.txt"]["encoding"], "utf-8")
            self.assertEqual(by_name["BOM中文.txt"]["encoding"], "utf-8-sig")
            self.assertEqual(by_name["空文件.txt"]["character_count"], 0)
            manifest = entries[0]["reproducibility_manifest"]
            self.assertEqual(manifest["project_id"], project["project_id"])
            self.assertEqual(manifest["document_id"], by_name["正常中文.txt"]["document_id"])
            self.assertEqual(manifest["file_hash"], by_name["正常中文.txt"]["input_hash"])
            self.assertEqual(manifest["file_format"], "txt")
            self.assertEqual(manifest["encoding"], "utf-8")
            self.assertEqual(manifest["file_size"], by_name["正常中文.txt"]["file_size"])
            self.assertEqual(manifest["network_used"], False)

            reopened = request(
                "project.open",
                {"project_path": project_path},
                "reopen-after-import",
            )
            self.assertEqual(reopened["result"]["project"]["document_count"], 3)
            self.assertEqual(len(reopened["result"]["documents"]), 3)

            preview = request(
                "document.get",
                {
                    "project_path": project_path,
                    "document_id": by_name["BOM中文.txt"]["document_id"],
                },
                "preview-bom",
            )
            self.assertEqual(preview["result"]["document"]["text"], "带有 BOM 的中文文本。\n")

    def test_duplicate_hash_is_stable_and_original_file_is_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_path = self.create_project(Path(temporary_directory))["project"]["project_path"]
            source = FIXTURES / "正常中文.txt"
            before = source.read_bytes()
            expected_hash = "f64cda9330e9848c35ab46fcdbce202470ef0a5f82b4a68795dbf60bc89fcc49"

            first = request(
                "corpus.import_txt",
                {"project_path": project_path, "file_paths": [str(source)]},
                "first-import",
            )
            second = request(
                "corpus.import_txt",
                {"project_path": project_path, "file_paths": [str(source)]},
                "duplicate-import",
            )

            first_document = first["result"]["entries"][0]["document"]
            duplicate = second["result"]["entries"][0]
            self.assertEqual(first_document["input_hash"], expected_hash)
            self.assertEqual(duplicate["status"], "duplicate")
            self.assertEqual(duplicate["document"]["document_id"], first_document["document_id"])
            self.assertEqual(source.read_bytes(), before)
            stored_sources = list((Path(project_path) / "corpus" / "original").glob("*.txt"))
            self.assertEqual(len(stored_sources), 1)
            self.assertEqual(stored_sources[0].read_bytes(), before)

    def test_long_text_is_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            long_file = temporary_path / "超长文本.txt"
            text = "研究文本。" * 200_000
            long_file.write_text(text, encoding="utf-8")
            project_path = self.create_project(temporary_path)["project"]["project_path"]

            imported = request(
                "corpus.import_txt",
                {"project_path": project_path, "file_paths": [str(long_file)]},
                "long-import",
            )
            document = imported["result"]["entries"][0]["document"]
            preview = request(
                "document.get",
                {"project_path": project_path, "document_id": document["document_id"]},
                "long-preview",
            )

            self.assertEqual(document["character_count"], len(text))
            self.assertEqual(preview["result"]["document"]["text"], text)

    def test_invalid_encoding_read_failure_and_non_txt_are_explicit_per_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            invalid_encoding = temporary_path / "异常编码.txt"
            invalid_encoding.write_bytes(b"\x81\x30\x81")
            unsupported = temporary_path / "表格.csv"
            unsupported.write_text("text", encoding="utf-8")
            missing = temporary_path / "不存在.txt"
            project_path = self.create_project(temporary_path)["project"]["project_path"]

            response = request(
                "corpus.import_txt",
                {
                    "project_path": project_path,
                    "file_paths": [str(invalid_encoding), str(missing), str(unsupported)],
                },
                "failed-imports",
            )

            self.assertEqual(response["type"], "result", response)
            entries = response["result"]["entries"]
            self.assertEqual(
                [entry["status"] for entry in entries],
                ["failed", "failed", "failed"],
            )
            self.assertEqual(
                [entry["error"]["code"] for entry in entries],
                ["unsupported_encoding", "file_read_failed", "unsupported_format"],
            )
            self.assertEqual(response["result"]["project"]["document_count"], 0)

    def test_opening_internal_directory_explains_project_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            project = self.create_project(Path(temporary_directory), "基层治理访谈")["project"]
            response = request("project.open", {"project_path": str(Path(project["project_path"]) / "corpus")}, "open-corpus")
            self.assertEqual(response["type"], "error")
            self.assertEqual(response["error"]["code"], "project_subdirectory")
            self.assertIn("基层治理访谈", response["error"]["message"])

    def test_cleaning_preserves_original_and_restores_analysis_text(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "清洗.txt"
            source.write_bytes((FIXTURES.parent / "cleaning/sample.txt").read_bytes())
            project_path = self.create_project(Path(temporary_directory))["project"]["project_path"]
            imported = request("corpus.import_txt", {"project_path": project_path, "file_paths": [str(source)]}, "clean-import")
            document = imported["result"]["entries"][0]["document"]
            rules = {"normalize_whitespace": True, "normalize_newlines": True, "remove_urls": True, "strip_html": True, "punctuation_mode": "remove"}
            preview = request("text.clean.preview", {"project_path": project_path, "document_id": document["document_id"], "rules": rules}, "clean-preview")
            self.assertEqual(preview["result"]["analysis_text"], "中文 标签\n第二行")
            executed = request("text.clean.execute", {"project_path": project_path, "document_id": document["document_id"], "rules": rules}, "clean-execute")
            self.assertEqual(executed["result"]["analysis_text"], preview["result"]["analysis_text"])
            reopened = request("document.get", {"project_path": project_path, "document_id": document["document_id"]}, "clean-reopen")
            self.assertEqual(reopened["result"]["document"]["text"], "  中文  https://example.com  <b>标签</b>\n第二行！  \n")
            self.assertEqual(reopened["result"]["document"]["analysis_text"], "中文 标签\n第二行")
            self.assertEqual(reopened["result"]["document"]["cleaning_config"], rules)


if __name__ == "__main__":
    unittest.main()
