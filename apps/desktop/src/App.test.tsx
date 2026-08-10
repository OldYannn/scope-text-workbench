import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type EngineMessage = {
  request_id: string;
  type: "progress" | "result" | "error";
  progress?: { current: number; total: number; message: string };
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
};

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  progressHandler: undefined as
    ((event: { payload: EngineMessage }) => void) | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("diagnostic controls", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
    mocks.progressHandler = undefined;
    mocks.listen.mockImplementation(
      async (
        _event: string,
        handler: (event: { payload: EngineMessage }) => void,
      ) => {
        mocks.progressHandler = handler;
        return () => undefined;
      },
    );
  });

  afterEach(() => cleanup());

  it("ignores unrelated progress and clears busy state after completion", async () => {
    const diagnostic = deferred<EngineMessage>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "diagnostic_run") return diagnostic.promise;
      throw new Error(`Unexpected command: ${command}`);
    });
    const user = userEvent.setup();
    render(<App />);

    const runButton = screen.getByRole("button", { name: "运行诊断" });
    await user.click(runButton);
    expect((runButton as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(mocks.progressHandler).toBeDefined());

    act(() => {
      mocks.progressHandler?.({
        payload: {
          request_id: "another-request",
          type: "progress",
          progress: { current: 5, total: 5, message: "wrong request" },
        },
      });
    });
    expect(screen.getByLabelText("诊断进度 0%")).toBeTruthy();

    const request = mocks.invoke.mock.calls[0][1] as { requestId: string };
    act(() => {
      mocks.progressHandler?.({
        payload: {
          request_id: request.requestId,
          type: "progress",
          progress: { current: 2, total: 5, message: "current request" },
        },
      });
    });
    expect(screen.getByLabelText("诊断进度 40%")).toBeTruthy();

    act(() => {
      diagnostic.resolve({
        request_id: request.requestId,
        type: "result",
        result: { reproducibility_manifest: {} },
      });
    });
    await waitFor(() =>
      expect((runButton as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByText("诊断完成，已生成可复现清单")).toBeTruthy();
  });

  it("blocks every other operation while recovery is running", async () => {
    const crash = deferred<EngineMessage>();
    mocks.invoke.mockImplementation(
      (command: string, arguments_: { requestId: string }) => {
        if (command === "diagnostic_crash") return crash.promise;
        if (command === "engine_describe") {
          return Promise.resolve({
            request_id: arguments_.requestId,
            type: "result",
            result: { engine_version: "0.0.0" },
          });
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    );
    const user = userEvent.setup();
    render(<App />);

    const runButton = screen.getByRole("button", { name: "运行诊断" });
    const recoveryButton = screen.getByRole("button", { name: "验证异常恢复" });
    await user.click(recoveryButton);
    expect((runButton as HTMLButtonElement).disabled).toBe(true);
    expect((recoveryButton as HTMLButtonElement).disabled).toBe(true);
    await user.click(runButton);
    await user.click(recoveryButton);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    const crashRequest = mocks.invoke.mock.calls[0][1] as { requestId: string };
    act(() => {
      crash.resolve({
        request_id: crashRequest.requestId,
        type: "error",
        error: { code: "engine_exited", message: "expected diagnostic crash" },
      });
    });
    await screen.findByText("恢复验证通过：旧请求未重放，新请求已由新进程响应");
    expect((runButton as HTMLButtonElement).disabled).toBe(false);
    expect((recoveryButton as HTMLButtonElement).disabled).toBe(false);
  });
});
