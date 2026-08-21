import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

const emptyProject = {
  project_id: "project-1",
  name: "基层治理访谈",
  created_at: "2026-08-21T08:00:00.000Z",
  software_version: "0.0.0",
  format_version: 1,
  project_path: "/研究/基层治理访谈",
  document_count: 0,
  total_characters: 0,
  last_imported_at: null,
};

const document = {
  document_id: "document-1",
  original_filename: "访谈一.txt",
  source_path: "/语料/访谈一.txt",
  imported_at: "2026-08-21T08:05:00.000Z",
  character_count: 8,
  file_size: 24,
  input_hash: "abc123",
  file_format: "txt",
  encoding: "utf-8",
  import_status: "imported",
};

describe("Milestone 1A project workflow", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "e2e_paths")
        return Promise.reject(new Error("not available"));
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  afterEach(() => cleanup());

  it("creates a project, imports TXT files, and opens a text preview", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "e2e_paths")
        return Promise.reject(new Error("not available"));
      if (command === "select_project_parent") return Promise.resolve("/研究");
      if (command === "select_txt_files")
        return Promise.resolve(["/语料/访谈一.txt"]);
      if (command === "project_create") {
        return Promise.resolve({
          type: "result",
          result: { project: emptyProject, documents: [] },
        });
      }
      if (command === "corpus_import_txt") {
        return Promise.resolve({
          type: "result",
          result: {
            project: {
              ...emptyProject,
              document_count: 1,
              total_characters: 8,
              last_imported_at: document.imported_at,
            },
            entries: [
              { status: "imported", document },
              {
                source_path: "/语料/乱码.txt",
                status: "failed",
                error: { code: "unsupported_encoding", message: "invalid" },
              },
              {
                source_path: "/语料/丢失.txt",
                status: "failed",
                error: { code: "file_read_failed", message: "missing" },
              },
            ],
          },
        });
      }
      if (command === "document_get") {
        return Promise.resolve({
          type: "result",
          result: { document: { ...document, text: "真实访谈文本内容" } },
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("项目名称"), "基层治理访谈");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(
      await screen.findByRole("heading", { name: "基层治理访谈" }),
    ).toBeTruthy();
    expect(screen.getByText("还没有导入语料")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "导入 TXT" }));
    expect(await screen.findByText("访谈一.txt")).toBeTruthy();
    expect(screen.getByText("1 篇文档")).toBeTruthy();
    const issues = within(screen.getByLabelText("导入失败详情"))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(issues[0]).toContain("乱码.txt：文件不是 UTF-8 编码");
    expect(issues[0]).toContain("/语料/乱码.txt");
    expect(issues[1]).toContain("丢失.txt：文件不存在或无法读取");
    expect(issues[1]).toContain("/语料/丢失.txt");

    await user.click(screen.getByRole("button", { name: /访谈一\.txt/ }));
    expect(await screen.findByText("真实访谈文本内容")).toBeTruthy();
  });

  it("opens an existing project and restores its saved document list", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "e2e_paths")
        return Promise.reject(new Error("not available"));
      if (command === "select_project_folder")
        return Promise.resolve("/研究/基层治理访谈");
      if (command === "project_open") {
        return Promise.resolve({
          type: "result",
          result: {
            project: {
              ...emptyProject,
              document_count: 1,
              total_characters: 8,
              last_imported_at: document.imported_at,
            },
            documents: [document],
          },
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开已有项目" }));

    expect(
      await screen.findByRole("heading", { name: "基层治理访谈" }),
    ).toBeTruthy();
    expect(screen.getByText("访谈一.txt")).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "project_open",
      expect.objectContaining({ projectPath: "/研究/基层治理访谈" }),
    );
  });
});
