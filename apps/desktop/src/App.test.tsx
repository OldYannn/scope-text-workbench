import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

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

    await user.click(screen.getByRole("button", { name: "清洗" }));
    await user.click(screen.getByRole("button", { name: "重新清洗全部文档" }));
    expect(screen.getByText(/重新清洗将更新分析文本/)).toBeTruthy();
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "text_clean_batch",
      ),
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "取消" }));
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

  it("truncates a long preview filename without losing its accessible full name", async () => {
    const longFilename =
      "中国证券监督管理委员会关于准予中欧养老产业混合型证券投资基金注册的批复-without-any-spaces.txt";
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "e2e_paths")
        return Promise.reject(new Error("not available"));
      if (command === "select_project_folder")
        return Promise.resolve("/研究/基层治理访谈");
      if (command === "project_open") {
        return Promise.resolve({
          type: "result",
          result: {
            project: { ...emptyProject, document_count: 1 },
            documents: [{ ...document, original_filename: longFilename }],
          },
        });
      }
      if (command === "document_get") {
        return Promise.resolve({
          type: "result",
          result: {
            document: {
              ...document,
              original_filename: longFilename,
              text: "长文件名测试文本",
            },
          },
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开已有项目" }));
    await user.click(screen.getByText(longFilename));

    const filename = await screen.findByTestId("preview-filename");
    expect(filename.getAttribute("title")).toBe(longFilename);
    expect(filename.textContent).toBe(longFilename);
    expect(filename.className).toContain("preview-filename");
  });

  it("renders a successful frequency response in the active workspace", async () => {
    let frequencyCalls = 0;
    const frequency = {
      rows: [
        {
          token: "基层治理",
          tf: 2,
          df: 1,
          document_coverage: 1,
          rf10k: 5000,
        },
      ],
      candidates: [
        {
          token: "进行",
          tf: 8,
          df: 1,
          document_coverage: 1,
          rf10k: 20000,
        },
        {
          token: "相关",
          tf: 6,
          df: 1,
          document_coverage: 1,
          rf10k: 15000,
        },
        {
          token: "本文",
          tf: 4,
          df: 1,
          document_coverage: 1,
          rf10k: 10000,
        },
      ],
      manifest: {
        included_document_count: 1,
        excluded_document_ids: [],
        effective_token_count: 4,
        raw_token_count: 4,
        eligible_token_count: 4,
        stopword_base_profile_id: "scope-cn-general-v1",
        resolved_stopword_hash: "hash",
      },
      skipped_document_count: 0,
      result_hash: "result-hash",
      profile: {
        base_profile_id: "scope-cn-general-v1",
        base_profile_version: "1",
        base_profile_hash: "profile-hash",
        custom_additions: [],
        custom_exclusions: [],
        resolved_stopwords: ["的"],
        resolved_stopword_hash: "hash",
      },
    };
    mocks.invoke.mockImplementation((command: string, payload?: unknown) => {
      if (command === "e2e_paths") return Promise.reject(new Error("none"));
      if (command === "select_project_parent") return Promise.resolve("/研究");
      if (command === "project_create")
        return Promise.resolve({
          type: "result",
          result: {
            project: { ...emptyProject, document_count: 1 },
            documents: [document],
          },
        });
      if (command === "stopword_profiles")
        return Promise.resolve({
          type: "result",
          result: {
            profiles: [
              {
                profile_id: "scope-cn-general-v1",
                version: "1",
                label: "SCOPE",
                count: 86,
                status: "draft",
              },
            ],
          },
        });
      if (command === "stopword_get")
        return Promise.resolve({
          type: "result",
          result: { profile: frequency.profile },
        });
      if (command === "document_get")
        return Promise.resolve({
          type: "result",
          result: {
            document: {
              ...document,
              text: "基层治理需要政策支持。",
              analysis_text: "基层治理需要政策支持。",
              tokens: [{ index: 0, token: "基层治理" }],
              tokenization_manifest: null,
            },
          },
        });
      if (command === "frequency_analyze")
        return Promise.resolve({
          type: "result",
          result:
            frequencyCalls++ === 0
              ? frequency
              : {
                  ...frequency,
                  rows: [],
                  candidates: [],
                  profile: {
                    ...frequency.profile,
                    custom_additions: ["进行", "基层治理"],
                    resolved_stopwords: ["的", "进行", "基层治理"],
                  },
                },
        });
      if (command === "stopword_resolve") {
        const config = payload as {
          baseProfileId: string;
          customAdditions: string[];
          customExclusions: string[];
        };
        return Promise.resolve({
          type: "result",
          result: {
            profile: {
              ...frequency.profile,
              base_profile_id: config.baseProfileId,
              custom_additions: config.customAdditions,
              custom_exclusions: config.customExclusions,
              resolved_stopwords: ["的", ...config.customAdditions].filter(
                (word) => !config.customExclusions.includes(word),
              ),
            },
          },
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("项目名称"), "频率测试");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    await user.click(screen.getByRole("button", { name: /访谈一\.txt/ }));
    await user.click(screen.getByRole("button", { name: "词频" }));
    expect(screen.getByTestId("pipeline-stage-text").textContent).toBe(
      "语料✓ 1 篇",
    );
    expect(screen.getByTestId("pipeline-stage-cleaning").textContent).toBe(
      "清洗0 / 1",
    );
    expect(screen.getByTestId("pipeline-stage-tokenize").textContent).toBe(
      "分词0 / 1",
    );
    expect(screen.getByTestId("pipeline-stage-frequency").textContent).toBe(
      "词频待计算",
    );
    await user.click(screen.getByTestId("pipeline-stage-cleaning"));
    expect(screen.getByLabelText("文本清洗")).toBeTruthy();
    await user.click(screen.getByTestId("pipeline-stage-tokenize"));
    expect(screen.getByLabelText("中文分词")).toBeTruthy();
    await user.click(screen.getByTestId("pipeline-stage-frequency"));
    expect(
      (
        screen.getByRole("button", {
          name: "计算 TF / DF / RF10K",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await user.click(
      screen.getByRole("button", { name: "计算 TF / DF / RF10K" }),
    );

    expect(
      await screen.findByText(
        "词频分析完成：1 / 1 篇文档参与分析；有效 token：4",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("cell", { name: "基层治理" })).toBeTruthy();
    expect(screen.getByText("导出 CSV")).toBeTruthy();
    expect(screen.getByText("导出 XLSX")).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "词频（TF）" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("columnheader", {
        name: "标准化词频（每万词，RF10K）",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: "词语" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "指标说明" }));
    expect(screen.getByRole("heading", { name: "词频指标说明" })).toBeTruthy();
    expect(screen.getByText("TF｜词频")).toBeTruthy();
    expect(screen.getByText("DF｜文档频率")).toBeTruthy();
    expect(screen.getByText(/RF10K\(w\) = TF\(w\)/)).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("heading", { name: "词频指标说明" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "查看实际词表" }));
    expect(
      screen.getByRole("heading", { name: "当前停用词集合" }),
    ).toBeTruthy();
    expect(
      globalThis.document.querySelector(".frequency-table"),
    ).not.toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "当前停用词集合" }),
      ).toBeNull(),
    );
    expect(globalThis.document.activeElement).toBe(
      screen.getByRole("button", { name: "查看实际词表" }),
    );

    await user.click(screen.getByRole("button", { name: "查看实际词表" }));
    const resolvedViewer = screen.getByLabelText("实际停用词集合");
    await user.click(within(resolvedViewer).getByText("的"));
    expect(screen.queryByText(/待应用修改/)).toBeNull();
    await user.click(
      within(resolvedViewer).getByRole("button", { name: "保留该词" }),
    );
    expect(screen.getByText("待应用修改：1 项")).toBeTruthy();
    const resolvedDrawer = screen.getByRole("dialog", {
      name: "当前停用词集合",
    });
    await user.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.animationEnd(resolvedDrawer);
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "当前停用词集合" }),
      ).toBeNull(),
    );
    await user.click(screen.getByRole("button", { name: "撤销保留：的" }));
    expect(screen.queryByText(/待应用修改/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "候选停用词检查" }));
    expect(
      screen.getByRole("heading", { name: "候选停用词检查" }),
    ).toBeTruthy();
    expect(screen.getByText("当前候选规则")).toBeTruthy();
    expect(
      screen.getByText(
        "文档覆盖率 ≥ 80% · 最多显示 100 项 · 按词频（TF）从高到低排序",
      ),
    ).toBeTruthy();
    expect(
      globalThis.document.querySelector(".frequency-table"),
    ).not.toBeNull();
    const optimization = globalThis.document.querySelector(".drawer-content");
    expect(optimization).not.toBeNull();
    const candidateRows = optimization!.querySelectorAll(".candidate-row");
    expect(
      within(candidateRows[0] as HTMLElement).getByText("TF 8"),
    ).toBeTruthy();
    expect(
      within(candidateRows[0] as HTMLElement).getByText(
        "出现在 100.0% 的参与文档中",
      ),
    ).toBeTruthy();
    await user.click(
      within(candidateRows[0] as HTMLElement).getByRole("button", {
        name: "加入待处理停用词",
      }),
    );
    await user.click(
      within(candidateRows[1] as HTMLElement).getByRole("button", {
        name: "保留",
      }),
    );
    await user.click(
      within(candidateRows[2] as HTMLElement).getByRole("button", {
        name: "忽略",
      }),
    );
    expect(
      within(candidateRows[0] as HTMLElement).getByText("待加入停用词"),
    ).toBeTruthy();
    expect(
      within(candidateRows[1] as HTMLElement).getByText("保留"),
    ).toBeTruthy();
    expect(
      within(candidateRows[2] as HTMLElement).getByText("忽略"),
    ).toBeTruthy();
    await user.click(
      within(candidateRows[2] as HTMLElement).getByRole("button", {
        name: "撤销",
      }),
    );
    await user.click(
      within(candidateRows[1] as HTMLElement).getByRole("button", {
        name: "撤销",
      }),
    );
    const optimizationDrawer = screen.getByRole("dialog", {
      name: "候选停用词检查",
    });
    await user.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.animationEnd(optimizationDrawer);
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "候选停用词检查" }),
      ).toBeNull(),
    );
    expect(globalThis.document.activeElement).toBe(
      screen.getByRole("button", { name: "候选停用词检查" }),
    );

    await user.type(screen.getByLabelText("手动增加停用词"), "基层治理");
    await user.click(screen.getByRole("button", { name: "增加" }));
    expect(screen.getByRole("cell", { name: "基层治理" })).toBeTruthy();
    expect(screen.getByText("待应用修改：2 项")).toBeTruthy();
    expect(screen.getByTestId("pipeline-stage-frequency").textContent).toBe(
      "词频需重新计算",
    );
    expect(
      screen.getByRole("button", { name: "导出 CSV" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "stopword_resolve",
      ),
    ).toHaveLength(0);

    await user.click(
      screen.getByRole("button", { name: "应用修改并重新计算" }),
    );
    expect(await screen.findByText(/过滤后没有可显示的词频结果/)).toBeTruthy();
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "stopword_resolve",
      ),
    ).toHaveLength(1);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "stopword_resolve",
      expect.objectContaining({
        customAdditions: ["进行", "基层治理"],
        customExclusions: [],
      }),
    );
    expect(frequencyCalls).toBe(2);
  });
});
