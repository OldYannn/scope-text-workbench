from __future__ import annotations

import unittest
from unittest.mock import patch

from scope_engine.__main__ import ACTIVE_TASKS, TaskRegistry, run_diagnostic


class TaskRegistryTest(unittest.TestCase):
    def test_cancel_and_finish_have_one_atomic_terminal_decision(self) -> None:
        registry = TaskRegistry()
        cancelled_task = registry.start("cancelled")
        assert cancelled_task is not None

        self.assertTrue(registry.cancel("cancelled"))
        self.assertTrue(registry.finish("cancelled", cancelled_task))
        self.assertFalse(registry.cancel("cancelled"))

        completed_task = registry.start("completed")
        assert completed_task is not None
        self.assertFalse(registry.finish("completed", completed_task))
        self.assertFalse(registry.cancel("completed"))

    def test_unexpected_worker_error_emits_terminal_internal_error(self) -> None:
        request_id = "worker-error-test"
        cancel_event = ACTIVE_TASKS.start(request_id)
        assert cancel_event is not None
        emitted: list[dict[str, object]] = []

        def fail_then_capture(response: dict[str, object]) -> None:
            if not emitted:
                emitted.append({"first_attempt": True})
                raise RuntimeError("simulated progress failure")
            emitted.append(response)

        with patch("scope_engine.__main__.emit", side_effect=fail_then_capture):
            run_diagnostic(request_id, 1, 0, cancel_event)

        self.assertEqual(emitted[-1]["type"], "error")
        error = emitted[-1]["error"]
        assert isinstance(error, dict)
        self.assertEqual(error["code"], "internal_error")
        self.assertFalse(ACTIVE_TASKS.cancel(request_id))


if __name__ == "__main__":
    unittest.main()
