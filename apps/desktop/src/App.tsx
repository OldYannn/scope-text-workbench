import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import "./App.css";

type ProjectSummary = {
  project_id: string;
  name: string;
  created_at: string;
  software_version: string;
  format_version: number;
  project_path: string;
  document_count: number;
  total_characters: number;
  last_imported_at: string | null;
};

type DocumentSummary = {
  document_id: string;
  original_filename: string;
  source_path: string;
  imported_at: string;
  character_count: number;
  file_size: number;
  input_hash: string;
  file_format: "txt";
  encoding: "utf-8" | "utf-8-sig";
  import_status: "imported" | "empty";
};

type CleaningRules = {
  normalize_whitespace: boolean;
  normalize_newlines: boolean;
  remove_urls: boolean;
  strip_html: boolean;
  punctuation_mode: "keep" | "remove";
};

type DocumentDetail = DocumentSummary & {
  text: string;
  analysis_text?: string | null;
  cleaning_config?: CleaningRules | null;
  tokenization_manifest?: TokenizationManifest | null;
  tokens?: Token[] | null;
};

type Token = { index: number; token: string };
type TokenizationManifest = {
  engine: string;
  engine_version: string;
  mode: string;
  hmm: boolean;
  user_dictionary: string;
  user_dictionary_id?: string | null;
  user_dictionary_hash: string | null;
  input_analysis_text_hash: string;
  tokenization_implementation_version: string;
  executed_at: string;
};
type UserDictionary = {
  dictionary_id: string;
  name: string;
  hash: string;
  file_size: number;
  imported_at: string;
};
type FrequencyRow = {
  token: string;
  tf: number;
  df: number;
  document_coverage: number;
  rf10k: number;
};
type FrequencyResult = {
  rows: FrequencyRow[];
  candidates: FrequencyRow[];
  manifest: {
    included_document_count: number;
    excluded_document_ids: string[];
    effective_token_count: number;
    raw_token_count: number;
    eligible_token_count: number;
    stopword_base_profile_id: string;
    resolved_stopword_hash: string;
  };
  skipped_document_count: number;
  result_hash: string;
  profile: StopwordProfile;
};
type StopwordProfile = {
  base_profile_id: string;
  base_profile_version: string;
  base_profile_hash: string;
  custom_additions: string[];
  custom_exclusions: string[];
  resolved_stopwords: string[];
  resolved_stopword_hash: string;
  status?: string;
};
type StopwordOption = {
  profile_id: string;
  version: string;
  label: string;
  count: number;
  status: string;
};

type EngineMessage<T> = {
  type: "result" | "error";
  result?: T;
  error?: { code: string; message: string };
};

type ProjectResult = {
  project: ProjectSummary;
  documents: DocumentSummary[];
};

type ImportEntry = {
  source_path?: string;
  status: "imported" | "empty" | "duplicate" | "failed";
  document?: DocumentSummary;
  error?: { code: string; message: string };
};

type ImportResult = {
  project: ProjectSummary;
  entries: ImportEntry[];
};

type E2ePaths = {
  parent_path: string;
  file_paths: string[];
} | null;

type ImportIssue = {
  filename: string;
  message: string;
  sourcePath: string;
};

const errorMessages: Record<string, string> = {
  invalid_project_name: "项目名称为空，或包含 Windows 不支持的字符",
  project_location_unavailable: "选择的保存位置不可用",
  project_already_exists: "该位置已经有同名文件夹，请更换项目名称",
  project_create_failed: "无法在所选位置创建项目",
  invalid_project: "所选文件夹不是可读取的 SCOPE 项目",
  project_subdirectory:
    "检测到上一级文件夹可能是 SCOPE 项目，请选择提示中的项目文件夹",
  unsupported_project_version: "该项目由不兼容的 SCOPE 版本创建",
  unsupported_format: "当前版本只支持 TXT 文件",
  unsupported_encoding: "文件不是 UTF-8 编码，请转换为 UTF-8 后重试",
  file_read_failed: "文件不存在或无法读取",
  import_failed: "文件无法保存到项目中",
  document_not_found: "项目中找不到这篇文档",
  analysis_text_missing: "该文档尚未生成分析文本，请先执行文本清洗",
  dictionary_read_failed: "用户词典必须是 UTF-8 文本",
  dictionary_not_found: "项目中找不到该用户词典",
  unsupported_tokenization_mode: "当前版本只支持标准分词（精确模式）",
  stopword_read_failed: "停用词文件必须是 UTF-8 文本",
  frequency_not_available: "没有可导出的有效词频分析，请先重新计算",
};

function requestId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDate(value: string | null) {
  if (!value) return "尚未导入";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function engineError<T>(message: EngineMessage<T>, fallback: string) {
  if (!message.error) return fallback;
  return errorMessages[message.error.code] ?? fallback;
}

function displayFilename(path: string | undefined) {
  return path?.split(/[\\/]/).pop() || "未知文件";
}

function App() {
  const desktopRuntime = isTauri();
  const [projectName, setProjectName] = useState("");
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedDocument, setSelectedDocument] =
    useState<DocumentDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(
    desktopRuntime ? "所有数据仅保存在你的电脑上" : "请在 SCOPE 桌面应用中使用",
  );
  const [e2ePaths, setE2ePaths] = useState<E2ePaths>(null);
  const [desktopReady, setDesktopReady] = useState(!desktopRuntime);
  const [importIssues, setImportIssues] = useState<ImportIssue[]>([]);
  const [cleaningRules, setCleaningRules] = useState<CleaningRules>({
    normalize_whitespace: true,
    normalize_newlines: true,
    remove_urls: true,
    strip_html: true,
    punctuation_mode: "keep",
  });
  const [cleaningPreview, setCleaningPreview] = useState<string | null>(null);
  const [tokenizationConfig, setTokenizationConfig] = useState({
    mode: "accurate",
    hmm: true,
    dictionary_id: null as string | null,
  });
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tokenizationManifest, setTokenizationManifest] =
    useState<TokenizationManifest | null>(null);
  const [userDictionary, setUserDictionary] = useState<UserDictionary | null>(
    null,
  );
  const [frequency, setFrequency] = useState<FrequencyResult | null>(null);
  const [stopwordOptions, setStopwordOptions] = useState<StopwordOption[]>([]);
  const [stopwordProfile, setStopwordProfile] =
    useState<StopwordProfile | null>(null);
  const [stopwordBase, setStopwordBase] = useState("scope-cn-general-v1");
  const [stopwordAdditions, setStopwordAdditions] = useState<string[]>([]);
  const [stopwordExclusions, setStopwordExclusions] = useState<string[]>([]);
  const [stopwordInput, setStopwordInput] = useState("");
  const [showResolvedStopwords, setShowResolvedStopwords] = useState(false);
  const [showOptimization, setShowOptimization] = useState(false);
  const [sortKey, setSortKey] = useState<
    "tf" | "df" | "document_coverage" | "rf10k" | "token"
  >("tf");
  const [topN, setTopN] = useState("100");
  const [ignoredCandidates, setIgnoredCandidates] = useState<string[]>([]);
  const [stopwordLoadError, setStopwordLoadError] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<
    "text" | "cleaning" | "tokenize" | "frequency"
  >("text");

  useEffect(() => {
    if (!desktopRuntime) return;
    void invoke<E2ePaths>("e2e_paths")
      .then((paths) => setE2ePaths(paths))
      .catch(() => undefined)
      .finally(() => setDesktopReady(true));
  }, [desktopRuntime]);

  useEffect(() => {
    if (!project || !desktopRuntime) return;
    void Promise.all([
      Promise.resolve().then(() =>
        invoke<EngineMessage<{ profiles: StopwordOption[] }>>(
          "stopword_profiles",
          { requestId: requestId("stopword-profiles") },
        ),
      ),
      Promise.resolve().then(() =>
        invoke<EngineMessage<{ profile: StopwordProfile }>>("stopword_get", {
          requestId: requestId("stopword-get"),
          projectPath: project.project_path,
        }),
      ),
    ])
      .then(([profiles, active]) => {
        if (
          profiles.type === "error" ||
          active.type === "error" ||
          !profiles.result ||
          !active.result
        ) {
          throw new Error("停用词资源加载失败");
        }
        setStopwordLoadError(false);
        setStopwordOptions(profiles.result.profiles);
        if (active.result) {
          setStopwordProfile(active.result.profile);
          setStopwordBase(active.result.profile.base_profile_id);
          setStopwordAdditions(active.result.profile.custom_additions);
          setStopwordExclusions(active.result.profile.custom_exclusions);
        }
      })
      .catch(() => {
        setStopwordLoadError(true);
        setNotice("停用词资源加载失败，词频分析暂不可用。请点击“重试”。");
      });
  }, [project, desktopRuntime]);

  function retryStopwordLoading() {
    if (project) setProject({ ...project });
  }

  async function createProject() {
    if (!projectName.trim() || busy || !desktopRuntime) return;
    setBusy(true);
    try {
      const parentPath =
        e2ePaths?.parent_path ??
        (await invoke<string | null>("select_project_parent"));
      if (typeof parentPath !== "string") return;
      const message = await invoke<EngineMessage<ProjectResult>>(
        "project_create",
        {
          requestId: requestId("project-create"),
          name: projectName.trim(),
          parentPath,
        },
      );
      if (message.type === "error" || !message.result) {
        setNotice(`无法创建项目：${engineError(message, "未知错误")}`);
        return;
      }
      setProject(message.result.project);
      setDocuments(message.result.documents);
      setSelectedDocument(null);
      setImportIssues([]);
      setNotice("项目已创建并保存在本地");
    } catch (error) {
      setNotice(`无法创建项目：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openProject() {
    if (busy || !desktopRuntime) return;
    setBusy(true);
    setNotice("请选择 SCOPE 项目的 project.json 文件。");
    try {
      let projectPath: string | null;
      try {
        projectPath = await invoke<string | null>("select_project_json");
      } catch (error) {
        // Keeps older development harnesses usable; production uses the JSON picker above.
        if (!String(error).includes("Unexpected command")) throw error;
        projectPath = await invoke<string | null>("select_project_folder");
      }
      if (typeof projectPath !== "string") return;
      const message = await invoke<EngineMessage<ProjectResult>>(
        "project_open",
        {
          requestId: requestId("project-open"),
          projectPath,
        },
      );
      if (message.type === "error" || !message.result) {
        setNotice(`无法打开项目：${engineError(message, "未知错误")}`);
        return;
      }
      setProject(message.result.project);
      setDocuments(message.result.documents);
      setSelectedDocument(null);
      setImportIssues([]);
      setNotice("项目已打开，已恢复本地语料");
    } catch (error) {
      setNotice(`无法打开项目：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importTxt() {
    if (!project || busy) return;
    setBusy(true);
    setImportIssues([]);
    try {
      const selectedPaths =
        e2ePaths?.file_paths ??
        (await invoke<string[] | null>("select_txt_files"));
      if (!selectedPaths) return;
      const filePaths = Array.isArray(selectedPaths)
        ? selectedPaths
        : [selectedPaths];
      if (!filePaths.length) return;
      const message = await invoke<EngineMessage<ImportResult>>(
        "corpus_import_txt",
        {
          requestId: requestId("corpus-import"),
          projectPath: project.project_path,
          filePaths,
        },
      );
      if (message.type === "error" || !message.result) {
        setNotice(`无法导入语料：${engineError(message, "未知错误")}`);
        return;
      }
      const importedDocuments = message.result.entries.flatMap((entry) =>
        entry.document && entry.status !== "duplicate" ? [entry.document] : [],
      );
      setDocuments((current) => [
        ...importedDocuments,
        ...current.filter(
          (existing) =>
            !importedDocuments.some(
              (imported) => imported.document_id === existing.document_id,
            ),
        ),
      ]);
      setProject(message.result.project);
      const failed = message.result.entries.filter(
        (entry) => entry.status === "failed",
      );
      setImportIssues(
        failed.map((entry) => ({
          filename: displayFilename(entry.source_path),
          sourcePath: entry.source_path ?? "未知来源",
          message: entry.error
            ? (errorMessages[entry.error.code] ?? "无法读取")
            : "无法读取",
        })),
      );
      const duplicates = message.result.entries.filter(
        (entry) => entry.status === "duplicate",
      ).length;
      const added = importedDocuments.length;
      if (failed.length) {
        setNotice(
          `已导入 ${added} 个文件，${failed.length} 个失败：${failed[0].error ? (errorMessages[failed[0].error.code] ?? "无法读取") : "无法读取"}`,
        );
      } else if (duplicates) {
        setNotice(`已导入 ${added} 个文件，跳过 ${duplicates} 个重复文件`);
      } else {
        setNotice(`已导入 ${added} 个 TXT 文件`);
      }
    } catch (error) {
      setNotice(`无法导入语料：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function previewDocument(document: DocumentSummary) {
    if (!project || busy) return;
    setBusy(true);
    setNotice(`正在打开“${document.original_filename}”…`);
    try {
      const message = await invoke<EngineMessage<{ document: DocumentDetail }>>(
        "document_get",
        {
          requestId: requestId("document-get"),
          projectPath: project.project_path,
          documentId: document.document_id,
        },
      );
      if (message.type === "error" || !message.result) {
        setNotice(`无法查看文本：${engineError(message, "未知错误")}`);
        return;
      }
      const detail = message.result.document;
      setSelectedDocument(detail);
      setCleaningRules(detail.cleaning_config ?? cleaningRules);
      setCleaningPreview(null);
      setTokens(detail.tokens ?? []);
      setTokenizationManifest(detail.tokenization_manifest ?? null);
      setTokenizationConfig((current) => ({
        ...current,
        hmm: detail.tokenization_manifest?.hmm ?? current.hmm,
        dictionary_id: detail.tokenization_manifest?.user_dictionary_id ?? null,
      }));
      setNotice("正在查看保存在项目中的原始文本");
    } catch (error) {
      setNotice(`无法查看文本：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function importDictionary() {
    if (!project || busy || !desktopRuntime) return;
    setBusy(true);
    try {
      const path = await invoke<string | null>("select_user_dictionary");
      if (!path) return;
      const message = await invoke<
        EngineMessage<{ dictionary: UserDictionary }>
      >("tokenization_dictionary_import", {
        requestId: requestId("dictionary-import"),
        projectPath: project.project_path,
        filePath: path,
      });
      if (message.type === "error" || !message.result) {
        setNotice(`无法导入用户词典：${engineError(message, "未知错误")}`);
        return;
      }
      setUserDictionary(message.result.dictionary);
      setTokenizationConfig((current) => ({
        ...current,
        dictionary_id: message.result!.dictionary.dictionary_id,
      }));
      setTokens([]);
      setTokenizationManifest(null);
      setNotice(
        `已导入用户词典“${message.result.dictionary.name}”，请重新运行分词`,
      );
    } catch (error) {
      setNotice(`无法导入用户词典：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function executeTokenization() {
    if (!project || !selectedDocument || busy) return;
    setBusy(true);
    try {
      const message = await invoke<
        EngineMessage<{ tokens: Token[]; manifest: TokenizationManifest }>
      >("text_tokenize_execute", {
        requestId: requestId("tokenize"),
        projectPath: project.project_path,
        documentId: selectedDocument.document_id,
        config: tokenizationConfig,
      });
      if (message.type === "error" || !message.result) {
        setNotice(`无法执行分词：${engineError(message, "未知错误")}`);
        return;
      }
      setTokens(message.result.tokens);
      setTokenizationManifest(message.result.manifest);
      setSelectedDocument((current) =>
        current
          ? {
              ...current,
              tokens: message.result!.tokens,
              tokenization_manifest: message.result!.manifest,
            }
          : current,
      );
      setNotice(
        `分词已保存，共 ${message.result.tokens.length} 个 token；原始语料和分析文本未修改`,
      );
    } catch (error) {
      setNotice(`无法执行分词：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function executeFrequency() {
    if (!project || busy) return;
    setBusy(true);
    try {
      const message = await invoke<EngineMessage<FrequencyResult>>(
        "frequency_analyze",
        {
          requestId: requestId("frequency"),
          projectPath: project.project_path,
          profileConfig: {
            base_profile_id: stopwordBase,
            custom_additions: stopwordAdditions,
            custom_exclusions: stopwordExclusions,
          },
        },
      );
      if (message.type === "error" || !message.result) {
        setNotice(`无法计算词频：${engineError(message, "未知错误")}`);
        return;
      }
      setFrequency(message.result);
      setStopwordProfile(message.result.profile);
      setNotice(
        `词频分析完成：${message.result.manifest.included_document_count} / ${documents.length} 篇文档参与统计`,
      );
    } catch (error) {
      setNotice(`无法计算词频：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function resolveStopwords(
    nextBase = stopwordBase,
    additions = stopwordAdditions,
    exclusions = stopwordExclusions,
  ) {
    if (!project || busy) return;
    setBusy(true);
    try {
      const message = await invoke<EngineMessage<{ profile: StopwordProfile }>>(
        "stopword_resolve",
        {
          requestId: requestId("stopword-resolve"),
          projectPath: project.project_path,
          baseProfileId: nextBase,
          customAdditions: additions,
          customExclusions: exclusions,
        },
      );
      if (message.type === "error" || !message.result) {
        setNotice(`无法保存停用词配置：${engineError(message, "未知错误")}`);
        return;
      }
      setStopwordProfile(message.result.profile);
      setStopwordBase(nextBase);
      setStopwordAdditions(additions);
      setStopwordExclusions(exclusions);
      setFrequency(null);
      setNotice("停用词配置已变化，需要重新计算词频；现有分词结果不会改变。");
    } catch (error) {
      setNotice(`无法保存停用词配置：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function addStopword() {
    const word = stopwordInput.trim();
    if (!word || stopwordAdditions.includes(word)) return;
    setStopwordInput("");
    void resolveStopwords(
      stopwordBase,
      [...stopwordAdditions, word],
      stopwordExclusions,
    );
  }

  function keepStopword(word: string) {
    if (stopwordExclusions.includes(word)) return;
    void resolveStopwords(stopwordBase, stopwordAdditions, [
      ...stopwordExclusions,
      word,
    ]);
  }

  function addCandidate(word: string) {
    if (stopwordAdditions.includes(word)) return;
    void resolveStopwords(
      stopwordBase,
      [...stopwordAdditions, word],
      stopwordExclusions,
    );
  }

  async function importStopwords() {
    if (!project || busy || !desktopRuntime) return;
    const filePath = await invoke<string | null>("select_stopword_file");
    if (!filePath) return;
    const message = await invoke<EngineMessage<{ words: string[] }>>(
      "stopword_import",
      {
        requestId: requestId("stopword-import"),
        projectPath: project.project_path,
        filePath,
      },
    );
    if (message.type === "error" || !message.result) {
      setNotice(`无法导入停用词：${engineError(message, "未知错误")}`);
      return;
    }
    void resolveStopwords(
      stopwordBase,
      [...stopwordAdditions, ...message.result.words],
      stopwordExclusions,
    );
  }

  async function exportFrequency(format: "csv" | "xlsx") {
    if (!project || !frequency || busy || !desktopRuntime) return;
    const destination = await invoke<string | null>("select_frequency_export", {
      format,
    });
    if (!destination) return;
    const message = await invoke<EngineMessage<{ path: string }>>(
      "frequency_export",
      {
        requestId: requestId("frequency-export"),
        projectPath: project.project_path,
        destination,
        format,
      },
    );
    setNotice(
      message.type === "error"
        ? `导出失败：${engineError(message, "未知错误")}`
        : `已导出${format === "csv" ? " CSV" : " XLSX"}：${destination}`,
    );
  }

  async function previewCleaning() {
    if (!project || !selectedDocument || busy) return;
    setBusy(true);
    try {
      const message = await invoke<EngineMessage<{ analysis_text: string }>>(
        "text_clean_preview",
        {
          requestId: requestId("clean-preview"),
          projectPath: project.project_path,
          documentId: selectedDocument.document_id,
          rules: cleaningRules,
        },
      );
      if (message.type === "error" || !message.result) {
        setNotice(`无法预览清洗：${engineError(message, "未知错误")}`);
        return;
      }
      setCleaningPreview(message.result.analysis_text);
      setNotice("预览已更新，原始文本不会修改");
    } catch (error) {
      setNotice(`无法预览清洗：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function executeCleaning() {
    if (!project || !selectedDocument || busy) return;
    setBusy(true);
    try {
      const message = await invoke<EngineMessage<{ analysis_text: string }>>(
        "text_clean_execute",
        {
          requestId: requestId("clean-execute"),
          projectPath: project.project_path,
          documentId: selectedDocument.document_id,
          rules: cleaningRules,
        },
      );
      if (message.type === "error" || !message.result) {
        setNotice(`无法执行清洗：${engineError(message, "未知错误")}`);
        return;
      }
      setSelectedDocument((current) =>
        current
          ? {
              ...current,
              analysis_text: message.result?.analysis_text ?? null,
              cleaning_config: cleaningRules,
            }
          : current,
      );
      setCleaningPreview(message.result.analysis_text);
      setNotice("清洗已保存为分析文本，原始语料未修改");
    } catch (error) {
      setNotice(`无法执行清洗：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function closeProject() {
    setProject(null);
    setDocuments([]);
    setSelectedDocument(null);
    setProjectName("");
    setNotice("项目已关闭，数据仍保存在原项目文件夹中");
    setImportIssues([]);
  }

  if (!project) {
    return (
      <main className="app-shell welcome-shell" data-testid="scope-home">
        <header className="topbar">
          <div className="brand-lockup" aria-label="SCOPE 文镜">
            <span className="brand-mark">S</span>
            <span>
              <strong>SCOPE</strong>
              <small>文镜</small>
            </span>
          </div>
          <span className="phase-label">Milestone 1 · Pre-alpha</span>
        </header>

        <section className="welcome-panel">
          <div className="welcome-copy">
            <p className="kicker">LOCAL RESEARCH WORKSPACE</p>
            <h1>
              从一组文本，
              <br />
              开始可复现的研究。
            </h1>
            <p className="welcome-description">
              创建一个本地项目，导入 TXT 语料。SCOPE
              不需要账号，也不会上传你的研究材料。
            </p>
            <div className="privacy-note">
              <span aria-hidden="true">●</span>
              本轮功能完全离线
            </div>
          </div>

          <div className="create-card">
            <p className="card-number">01</p>
            <h2>新建研究项目</h2>
            <label htmlFor="project-name">项目名称</label>
            <input
              id="project-name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="例如：基层治理访谈"
              autoFocus
            />
            <button
              className="primary-button"
              disabled={
                !desktopRuntime || !desktopReady || !projectName.trim() || busy
              }
              onClick={() => void createProject()}
            >
              {busy ? "正在创建…" : "创建项目"}
            </button>
            <button
              className="text-button"
              disabled={!desktopRuntime || !desktopReady || busy}
              onClick={() => void openProject()}
            >
              打开已有项目
            </button>
          </div>
        </section>

        <p className="notice" aria-live="polite">
          {notice}
        </p>
      </main>
    );
  }

  return (
    <main className="app-shell workspace-shell" data-testid="scope-project">
      <header className="topbar workspace-topbar">
        <div className="brand-lockup" aria-label="SCOPE 文镜">
          <span className="brand-mark">S</span>
          <span>
            <strong>SCOPE</strong>
            <small>文镜</small>
          </span>
        </div>
        <div className="project-actions">
          <span className="saved-state">
            <i aria-hidden="true" />
            本地保存
          </span>
          <button className="text-button" onClick={closeProject}>
            关闭项目
          </button>
        </div>
      </header>

      <section className="project-heading">
        <div>
          <p className="kicker">CURRENT PROJECT / 当前项目</p>
          <h1>{project.name}</h1>
          <p className="project-location" title={project.project_path}>
            {project.project_path}
          </p>
        </div>
        <button
          className="primary-button import-button"
          aria-label="导入 TXT"
          disabled={busy}
          onClick={() => void importTxt()}
        >
          ＋ 导入 TXT
        </button>
      </section>

      <section className="stats-grid" aria-label="项目概览">
        <article>
          <span>语料数量</span>
          <strong>{project.document_count}</strong>
          <small>篇文档</small>
        </article>
        <article>
          <span>总字符数</span>
          <strong>{formatCount(project.total_characters)}</strong>
          <small>字符</small>
        </article>
        <article>
          <span>最近导入</span>
          <strong className="date-stat">
            {formatDate(project.last_imported_at)}
          </strong>
          <small>本地时间</small>
        </article>
      </section>

      <p className="notice workspace-notice" aria-live="polite">
        {notice}
      </p>
      <nav className="workspace-tabs" aria-label="研究工作区">
        {(
          [
            ["text", "文本"],
            ["cleaning", "清洗"],
            ["tokenize", "分词"],
            ["frequency", "词频"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={workspaceTab === key ? "active" : ""}
            onClick={() => setWorkspaceTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {importIssues.length > 0 && (
        <ul className="import-errors" aria-label="导入失败详情">
          {importIssues.map((issue, index) => (
            <li key={`${issue.sourcePath}-${index}`}>
              <strong>{issue.filename}</strong>：{issue.message}
              <small title={issue.sourcePath}>{issue.sourcePath}</small>
            </li>
          ))}
        </ul>
      )}

      <section className="corpus-workspace">
        <div className="document-panel">
          <div className="panel-heading">
            <div>
              <p className="kicker">CORPUS / 语料</p>
              <h2>语料列表</h2>
            </div>
            <span>{project.document_count} 篇文档</span>
          </div>
          {documents.length ? (
            <ul className="document-list">
              {documents.map((document) => (
                <li key={document.document_id}>
                  <button
                    className={
                      selectedDocument?.document_id === document.document_id
                        ? "active"
                        : ""
                    }
                    onClick={() => void previewDocument(document)}
                    disabled={busy}
                  >
                    <span className="file-icon" aria-hidden="true">
                      TXT
                    </span>
                    <span className="file-info">
                      <strong>{document.original_filename}</strong>
                      <small>
                        {formatCount(document.character_count)} 字符 ·{" "}
                        {document.encoding === "utf-8-sig"
                          ? "UTF-8 BOM"
                          : "UTF-8"}
                      </small>
                    </span>
                    <span className={`import-state ${document.import_status}`}>
                      {document.import_status === "empty" ? "空文件" : "已导入"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <span aria-hidden="true">文</span>
              <h3>还没有导入语料</h3>
              <p>点击“导入 TXT”，可以一次选择一个或多个文本文件。</p>
            </div>
          )}
        </div>

        <article className="preview-panel">
          <div className="panel-heading">
            <div>
              <p className="kicker">PREVIEW / 文本预览</p>
              <h2>{selectedDocument?.original_filename ?? "选择一篇语料"}</h2>
            </div>
            {selectedDocument && (
              <span>{formatCount(selectedDocument.character_count)} 字符</span>
            )}
          </div>
          {selectedDocument ? (
            <>
              {workspaceTab === "cleaning" && (
                <>
                  <div className="cleaning-toolbar" aria-label="文本清洗">
                    <strong>文本清洗</strong>
                    {(
                      Object.entries(cleaningRules) as [
                        keyof CleaningRules,
                        boolean | string,
                      ][]
                    )
                      .filter(([key]) => key !== "punctuation_mode")
                      .map(([key, value]) => (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={Boolean(value)}
                            onChange={(event) =>
                              setCleaningRules((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          {
                            (
                              {
                                normalize_whitespace: "空白规范化",
                                normalize_newlines: "换行规范化",
                                remove_urls: "删除 URL",
                                strip_html: "清理 HTML",
                              } as Record<string, string>
                            )[key]
                          }
                        </label>
                      ))}
                    <label>
                      标点
                      <select
                        value={cleaningRules.punctuation_mode}
                        onChange={(event) =>
                          setCleaningRules((current) => ({
                            ...current,
                            punctuation_mode: event.target.value as
                              "keep" | "remove",
                          }))
                        }
                      >
                        <option value="keep">保留</option>
                        <option value="remove">删除</option>
                      </select>
                    </label>
                    <button
                      className="text-button"
                      onClick={() => void previewCleaning()}
                      disabled={busy}
                    >
                      预览
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => void executeCleaning()}
                      disabled={busy}
                    >
                      执行清洗
                    </button>
                  </div>
                  <p className="cleaning-note">
                    清洗结果保存为分析文本，不会修改原始语料。
                  </p>
                </>
              )}
              {(workspaceTab === "text" || workspaceTab === "cleaning") && (
                <div className="text-preview-grid">
                  <div>
                    <small>原始文本（只读）</small>
                    <pre className="text-preview">
                      {selectedDocument.text || "（空文件）"}
                    </pre>
                  </div>
                  <div>
                    <small>分析文本</small>
                    <pre className="text-preview">
                      {cleaningPreview ??
                        selectedDocument.analysis_text ??
                        "尚未执行清洗"}
                    </pre>
                  </div>
                </div>
              )}
              {workspaceTab === "tokenize" && (
                <>
                  <div className="tokenization-toolbar" aria-label="中文分词">
                    <strong>中文分词</strong>
                    <span>标准分词（推荐）</span>
                    <label>
                      <input
                        type="checkbox"
                        checked={tokenizationConfig.hmm}
                        onChange={(event) =>
                          setTokenizationConfig((current) => ({
                            ...current,
                            hmm: event.target.checked,
                          }))
                        }
                      />
                      识别词典外新词（HMM）
                    </label>
                    <span className="dictionary-status">
                      用户词典：
                      {userDictionary?.name ??
                        tokenizationManifest?.user_dictionary ??
                        "未使用"}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => void importDictionary()}
                      disabled={busy}
                    >
                      导入用户词典
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => void executeTokenization()}
                      disabled={busy || !selectedDocument.analysis_text}
                    >
                      重新运行分词
                    </button>
                  </div>
                  <p className="cleaning-note">
                    分词只使用分析文本，不会修改原始语料或分析文本。尚未清洗的文档不能静默使用原始文本。
                  </p>
                  {tokenizationManifest && (
                    <div className="tokenization-meta">
                      jieba {tokenizationManifest.engine_version} · 精确模式 ·
                      HMM {tokenizationManifest.hmm ? "开启" : "关闭"} · 输入
                      hash{" "}
                      {tokenizationManifest.input_analysis_text_hash.slice(
                        0,
                        12,
                      )}
                      …
                    </div>
                  )}
                  <div className="token-result" aria-label="分词结果">
                    {tokens.length ? (
                      tokens.map((item) => (
                        <span key={`${item.index}-${item.token}`}>
                          {item.token}
                        </span>
                      ))
                    ) : (
                      <small>尚未运行分词</small>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="preview-placeholder">
              <span aria-hidden="true">Aa</span>
              <p>从左侧语料列表选择一篇文档，在这里查看保存的原始文本。</p>
            </div>
          )}
        </article>
      </section>
      {workspaceTab === "frequency" && (
        <section className="frequency-panel" aria-label="词频分析">
          <div className="panel-heading">
            <div>
              <p className="kicker">FREQUENCY / 词频</p>
              <h2>词频统计</h2>
            </div>
            <button
              className="primary-button"
              onClick={() => void executeFrequency()}
              disabled={busy || stopwordLoadError}
            >
              计算 TF / DF / RF10K
            </button>
          </div>
          {stopwordLoadError && (
            <div className="feature-error" role="alert">
              <span>停用词资源加载失败，词频分析暂不可用。</span>
              <button className="text-button" onClick={retryStopwordLoading}>
                重试
              </button>
            </div>
          )}
          <div className="stopword-controls">
            <label>
              停用词方案
              <select
                value={stopwordBase}
                onChange={(event) => void resolveStopwords(event.target.value)}
                disabled={busy || stopwordLoadError}
              >
                {stopwordOptions.map((option) => (
                  <option value={option.profile_id} key={option.profile_id}>
                    {option.label}
                    {option.profile_id === "scope-cn-general-v1"
                      ? "（推荐，Draft）"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <span>
              版本：{stopwordProfile?.base_profile_version ?? "1"} · 生效词数：
              {stopwordProfile?.resolved_stopwords.length ?? 0} · 增加：
              {stopwordAdditions.length} · 保留：{stopwordExclusions.length}
            </span>
            <button
              className="text-button"
              onClick={() => setShowResolvedStopwords((value) => !value)}
            >
              {showResolvedStopwords ? "收起实际词表" : "查看实际词表"}
            </button>
            <button
              className="text-button"
              onClick={() => void importStopwords()}
              disabled={busy || stopwordLoadError}
            >
              导入 UTF-8 TXT
            </button>
            <input
              className="stopword-input"
              value={stopwordInput}
              onChange={(event) => setStopwordInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addStopword();
              }}
              placeholder="手动增加词语"
              aria-label="手动增加停用词"
            />
            <button
              className="text-button"
              onClick={addStopword}
              disabled={busy || stopwordLoadError}
            >
              增加
            </button>
            <button
              className="text-button"
              onClick={() =>
                void resolveStopwords("scope-cn-general-v1", [], [])
              }
              disabled={busy || stopwordLoadError}
            >
              恢复默认
            </button>
          </div>
          {showResolvedStopwords && (
            <div className="resolved-stopwords" aria-label="实际停用词集合">
              {(stopwordProfile?.resolved_stopwords ?? []).map((word) => (
                <button
                  key={word}
                  className="stopword-chip"
                  onClick={() => keepStopword(word)}
                  title="点击保留该词"
                >
                  {word}
                </button>
              ))}
            </div>
          )}
          {(stopwordAdditions.length > 0 || stopwordExclusions.length > 0) && (
            <div className="custom-stopwords">
              <span>
                增加：
                {stopwordAdditions.map((word) => (
                  <button
                    key={word}
                    className="stopword-chip"
                    onClick={() =>
                      void resolveStopwords(
                        stopwordBase,
                        stopwordAdditions.filter((item) => item !== word),
                        stopwordExclusions,
                      )
                    }
                  >
                    {word} ×
                  </button>
                ))}
              </span>
              <span>
                保留：
                {stopwordExclusions.map((word) => (
                  <button
                    key={word}
                    className="stopword-chip"
                    onClick={() =>
                      void resolveStopwords(
                        stopwordBase,
                        stopwordAdditions,
                        stopwordExclusions.filter((item) => item !== word),
                      )
                    }
                  >
                    {word} ×
                  </button>
                ))}
              </span>
            </div>
          )}
          <p className="cleaning-note">
            停用词只过滤下游统计，不修改已保存 token。SCOPE v1 当前为 Draft /
            开发版本，Public Alpha 前需通过多类型真实语料验证。
          </p>
          {frequency ? (
            <>
              <p className="cleaning-note">
                本次分析：{frequency.manifest.included_document_count} /{" "}
                {documents.length} 篇文档；{frequency.skipped_document_count}{" "}
                篇尚未完成分词或结果已失效，未参与统计。raw{" "}
                {formatCount(frequency.manifest.raw_token_count)}；eligible{" "}
                {formatCount(frequency.manifest.eligible_token_count)}
                ；effective{" "}
                {formatCount(frequency.manifest.effective_token_count)}。
              </p>
              <div className="frequency-toolbar">
                <label>
                  排序
                  <select
                    value={sortKey}
                    onChange={(event) =>
                      setSortKey(event.target.value as typeof sortKey)
                    }
                  >
                    <option value="tf">TF</option>
                    <option value="df">DF</option>
                    <option value="document_coverage">Coverage</option>
                    <option value="rf10k">RF10K</option>
                    <option value="token">词语</option>
                  </select>
                </label>
                <label>
                  显示
                  <select
                    value={topN}
                    onChange={(event) => setTopN(event.target.value)}
                  >
                    <option value="50">Top 50</option>
                    <option value="100">Top 100</option>
                    <option value="500">Top 500</option>
                    <option value="all">全部</option>
                  </select>
                </label>
                <button
                  className="text-button"
                  onClick={() => setShowOptimization((value) => !value)}
                  disabled={stopwordLoadError}
                >
                  停用词优化助手
                </button>
                <button
                  className="text-button"
                  onClick={() => void exportFrequency("csv")}
                  disabled={!frequency || stopwordLoadError}
                >
                  导出 CSV
                </button>
                <button
                  className="text-button"
                  onClick={() => void exportFrequency("xlsx")}
                  disabled={!frequency || stopwordLoadError}
                >
                  导出 XLSX
                </button>
              </div>
              {showOptimization && (
                <div className="optimization-panel">
                  <strong>停用词优化助手</strong>
                  <p>
                    以下词高频并广泛分布于语料中，可能值得检查是否属于本项目的通用语言噪声。系统不会自动删除，是否设为停用词由研究者决定。
                  </p>
                  {frequency.candidates
                    .filter((row) => !ignoredCandidates.includes(row.token))
                    .map((row) => (
                      <div className="candidate-row" key={row.token}>
                        <span>{row.token}</span>
                        <span>TF {row.tf}</span>
                        <span>DF {row.df}</span>
                        <span>{(row.document_coverage * 100).toFixed(1)}%</span>
                        <button
                          className="text-button"
                          onClick={() => addCandidate(row.token)}
                        >
                          加入项目停用词
                        </button>
                        <button
                          className="text-button"
                          onClick={() => keepStopword(row.token)}
                        >
                          保留
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            setIgnoredCandidates((current) => [
                              ...current,
                              row.token,
                            ])
                          }
                        >
                          忽略
                        </button>
                      </div>
                    ))}
                </div>
              )}
              <div className="frequency-table-wrap">
                <table className="frequency-table">
                  <thead>
                    <tr>
                      <th>词语</th>
                      <th>TF</th>
                      <th>DF</th>
                      <th>文档覆盖率</th>
                      <th>每万词频率</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...frequency.rows]
                      .sort((a, b) =>
                        sortKey === "token"
                          ? a.token.localeCompare(b.token, "zh")
                          : Number(b[sortKey]) - Number(a[sortKey]),
                      )
                      .slice(0, topN === "all" ? undefined : Number(topN))
                      .map((row) => (
                        <tr key={row.token}>
                          <td>{row.token}</td>
                          <td>{row.tf}</td>
                          <td>{row.df}</td>
                          <td>{(row.document_coverage * 100).toFixed(1)}%</td>
                          <td>{row.rf10k.toFixed(2)}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => addCandidate(row.token)}
                            >
                              加入停用词
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="frequency-empty-state">
              <p className="cleaning-note">
                尚未执行词频分析。完成分词后可计算第一版可复现词频结果。
              </p>
              <button className="text-button" disabled>
                导出 CSV
              </button>
              <button className="text-button" disabled>
                导出 XLSX
              </button>
              <small>请先完成词频分析。</small>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export default App;
