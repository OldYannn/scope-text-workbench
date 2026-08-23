import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  cleaned_count?: number;
  tokenized_count?: number;
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
  is_cleaned?: boolean;
  is_tokenized?: boolean;
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
type FrequencyStatus = "idle" | "running" | "success" | "error";
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

type BatchResult = {
  total_document_count: number;
  eligible_document_count: number;
  processed_document_count: number;
  succeeded_count: number;
  failed_count: number;
  skipped_missing_analysis_text_count?: number;
  cancelled: boolean;
  entries: Array<{
    document_id: string;
    filename: string;
    status: "succeeded" | "failed";
    error?: { code: string; message: string };
  }>;
  project: ProjectSummary;
};

type BatchProgress = {
  requestId: string;
  current: number;
  total: number;
  message: string;
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

function sameStringSet(left: string[], right: string[]) {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

type FrequencyWorkspaceProps = {
  frequency: FrequencyResult | null;
  status: FrequencyStatus;
  error: string | null;
  busy: boolean;
  stopwordLoadError: boolean;
  stopwordOptions: StopwordOption[];
  stopwordProfile: StopwordProfile | null;
  stopwordBase: string;
  stopwordAdditions: string[];
  stopwordExclusions: string[];
  stopwordInput: string;
  showResolvedStopwords: boolean;
  showOptimization: boolean;
  sortKey: "tf" | "df" | "document_coverage" | "rf10k" | "token";
  topN: string;
  ignoredCandidates: string[];
  documentCount: number;
  hasPendingChanges: boolean;
  pendingCount: number;
  onExecute: () => void;
  onRetryStopword: () => void;
  onResolve: (
    base?: string,
    additions?: string[],
    exclusions?: string[],
  ) => void;
  onImport: () => void;
  onInputChange: (value: string) => void;
  onAdd: () => void;
  onReset: () => void;
  onToggleResolved: () => void;
  onToggleOptimization: () => void;
  onSortChange: (value: FrequencyWorkspaceProps["sortKey"]) => void;
  onTopNChange: (value: string) => void;
  onAddCandidate: (word: string) => void;
  onKeep: (word: string) => void;
  onIgnore: (word: string) => void;
  onExport: (format: "csv" | "xlsx") => void;
  onApplyChanges: () => void;
  onUndoAddition: (word: string) => void;
  onUndoExclusion: (word: string) => void;
  onUndoIgnore: (word: string) => void;
};

function FrequencyWorkspace({
  frequency,
  status,
  error,
  busy,
  stopwordLoadError,
  stopwordOptions,
  stopwordProfile,
  stopwordBase,
  stopwordAdditions,
  stopwordExclusions,
  stopwordInput,
  showResolvedStopwords,
  showOptimization,
  sortKey,
  topN,
  ignoredCandidates,
  documentCount,
  hasPendingChanges,
  pendingCount,
  onExecute,
  onRetryStopword,
  onResolve,
  onImport,
  onInputChange,
  onAdd,
  onReset,
  onToggleResolved,
  onToggleOptimization,
  onSortChange,
  onTopNChange,
  onAddCandidate,
  onKeep,
  onIgnore,
  onExport,
  onApplyChanges,
  onUndoAddition,
  onUndoExclusion,
  onUndoIgnore,
}: FrequencyWorkspaceProps) {
  const [showMetricHelp, setShowMetricHelp] = useState(false);
  const hasRows = Boolean(frequency?.rows.length);
  const includedCount = frequency?.manifest.included_document_count ?? 0;
  const resultMessage =
    status === "running"
      ? "正在计算词频……"
      : status === "error"
        ? error
        : status === "success" && includedCount === 0
          ? "当前没有可参与词频分析的文档。请先对至少一篇分析文本完成中文分词。"
          : status === "success" && !hasRows
            ? "当前配置过滤后没有可显示的词频结果。请检查停用词方案、自定义停用词和原始 token 数。"
            : status === "success"
              ? `词频分析完成：${includedCount} / ${documentCount} 篇文档参与分析；有效 token：${frequency?.manifest.effective_token_count ?? 0}`
              : "尚未执行词频分析。完成分词后可计算第一版可复现词频结果。";
  const unavailableActionHint = !frequency
    ? "请先完成词频分析。"
    : hasPendingChanges
      ? "请先应用停用词修改并重新计算。"
      : undefined;

  return (
    <section className="frequency-panel active-workspace" aria-label="词频分析">
      <div className="panel-heading">
        <div>
          <p className="kicker">FREQUENCY / 词频</p>
          <h2>词频统计</h2>
        </div>
        <button
          className="primary-button"
          onClick={onExecute}
          disabled={busy || stopwordLoadError || hasPendingChanges}
        >
          {status === "running" ? "正在计算…" : "计算 TF / DF / RF10K"}
        </button>
      </div>
      {stopwordLoadError && (
        <div className="feature-error" role="alert">
          <span>停用词资源加载失败，词频分析暂不可用。</span>
          <button className="text-button" onClick={onRetryStopword}>
            重试
          </button>
        </div>
      )}
      <div className="stopword-controls">
        <label>
          停用词方案
          <select
            value={stopwordBase}
            onChange={(event) => onResolve(event.target.value)}
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
        <button className="text-button" onClick={onToggleResolved}>
          {showResolvedStopwords ? "收起实际词表" : "查看实际词表"}
        </button>
        <button
          className="text-button"
          onClick={onImport}
          disabled={busy || stopwordLoadError}
        >
          导入 UTF-8 TXT
        </button>
        <input
          className="stopword-input"
          value={stopwordInput}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onAdd();
          }}
          placeholder="手动增加停用词"
          aria-label="手动增加停用词"
        />
        <button
          className="text-button"
          onClick={onAdd}
          disabled={busy || stopwordLoadError}
        >
          增加
        </button>
        <button
          className="text-button"
          onClick={onReset}
          disabled={busy || stopwordLoadError}
        >
          恢复默认
        </button>
      </div>
      {showResolvedStopwords && (
        <div className="resolved-stopwords" aria-label="实际停用词集合">
          {(stopwordProfile?.resolved_stopwords ?? []).map((word) => (
            <span key={word} className="resolved-stopword-item">
              <span className="stopword-chip">{word}</span>
              <button className="text-button" onClick={() => onKeep(word)}>
                保留该词
              </button>
            </span>
          ))}
        </div>
      )}
      {(stopwordAdditions.length > 0 || stopwordExclusions.length > 0) && (
        <div className="custom-stopwords" aria-label="项目停用词配置">
          <span>
            增加：
            {stopwordAdditions.map((word) => (
              <button
                key={word}
                className="stopword-chip"
                onClick={() => onUndoAddition(word)}
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
                onClick={() => onUndoExclusion(word)}
              >
                {word} ×
              </button>
            ))}
          </span>
        </div>
      )}
      {hasPendingChanges && (
        <div className="stale-result-banner" role="status">
          <div>
            <strong>待应用修改：{pendingCount} 项</strong>
            <span>停用词配置已修改，下面仍显示修改前的词频结果。</span>
          </div>
          <button
            className="primary-button"
            onClick={onApplyChanges}
            disabled={busy || stopwordLoadError}
          >
            应用修改并重新计算
          </button>
        </div>
      )}
      <p className="cleaning-note">
        停用词只过滤下游统计，不修改已保存 token。SCOPE v1 当前为 Draft /
        开发版本，Public Alpha 前需通过多类型真实语料验证。
      </p>
      <div
        className={`frequency-status frequency-status-${status}`}
        role={status === "error" ? "alert" : undefined}
      >
        {resultMessage}
      </div>
      <div className="frequency-toolbar">
        <label>
          排序
          <select
            value={sortKey}
            onChange={(event) =>
              onSortChange(
                event.target.value as FrequencyWorkspaceProps["sortKey"],
              )
            }
            disabled={!frequency}
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
            onChange={(event) => onTopNChange(event.target.value)}
            disabled={!frequency}
          >
            <option value="50">Top 50</option>
            <option value="100">Top 100</option>
            <option value="500">Top 500</option>
            <option value="all">全部</option>
          </select>
        </label>
        <button
          className="text-button"
          onClick={onToggleOptimization}
          disabled={!frequency || stopwordLoadError}
          title={!frequency ? unavailableActionHint : undefined}
        >
          停用词优化助手
        </button>
        <button
          className="text-button"
          onClick={() => onExport("csv")}
          disabled={!frequency || stopwordLoadError || hasPendingChanges}
          title={unavailableActionHint}
        >
          导出 CSV
        </button>
        <button
          className="text-button"
          onClick={() => onExport("xlsx")}
          disabled={!frequency || stopwordLoadError || hasPendingChanges}
          title={unavailableActionHint}
        >
          导出 XLSX
        </button>
        <button
          className="text-button metric-help-button"
          onClick={() => setShowMetricHelp((value) => !value)}
          aria-expanded={showMetricHelp}
        >
          ？ 指标说明
        </button>
      </div>
      {!frequency && !stopwordLoadError && (
        <small className="frequency-action-hint">
          请先完成词频分析，再使用停用词优化助手或导出。
        </small>
      )}
      {showMetricHelp && (
        <div className="metric-help" aria-label="词频指标说明">
          <p>
            <strong>TF｜词频</strong>{" "}
            某词在本次参与分析的全部文档中的总出现次数。
          </p>
          <p>
            <strong>DF｜文档频率</strong>{" "}
            至少出现一次该词的文档数量。同一文档重复出现不会重复增加 DF。
          </p>
          <p>
            <strong>文档覆盖率</strong> Coverage(w) = DF(w) /
            IncludedDocumentCount ×
            100%。它表示包含该词的文档占本次参与分析文档的比例。
          </p>
          <p>
            <strong>标准化词频（每万词，RF10K）</strong> RF10K(w) = TF(w) /
            EffectiveTokenCount × 10,000。
          </p>
          <p>
            <strong>EffectiveTokenCount</strong> 完成基础 token eligibility
            和当前停用词过滤后，实际参与本次统计的 token 总数。
          </p>
        </div>
      )}
      {showOptimization && frequency && (
        <div className="optimization-panel">
          <strong>停用词优化助手</strong>
          <p>
            以下词高频并广泛分布于语料中，可能值得检查是否属于本项目的通用语言噪声。系统不会自动删除，是否设为停用词由研究者决定。
          </p>
          {frequency.candidates.map((row) => {
            const candidateStatus = stopwordAdditions.includes(row.token)
              ? "待加入停用词"
              : stopwordExclusions.includes(row.token)
                ? "保留"
                : ignoredCandidates.includes(row.token)
                  ? "忽略"
                  : null;
            return (
              <div className="candidate-row" key={row.token}>
                <span>{row.token}</span>
                <span>TF {row.tf}</span>
                <span>DF {row.df}</span>
                <span>{(row.document_coverage * 100).toFixed(1)}%</span>
                {candidateStatus ? (
                  <>
                    <strong>{candidateStatus}</strong>
                    <button
                      className="text-button"
                      onClick={() =>
                        candidateStatus === "待加入停用词"
                          ? onUndoAddition(row.token)
                          : candidateStatus === "保留"
                            ? onUndoExclusion(row.token)
                            : onUndoIgnore(row.token)
                      }
                    >
                      撤销
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="text-button"
                      onClick={() => onAddCandidate(row.token)}
                    >
                      加入项目停用词
                    </button>
                    <button
                      className="text-button"
                      onClick={() => onKeep(row.token)}
                    >
                      保留
                    </button>
                    <button
                      className="text-button"
                      onClick={() => onIgnore(row.token)}
                    >
                      忽略
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {frequency.candidates.length === 0 && (
            <p>当前没有符合条件的候选停用词。</p>
          )}
        </div>
      )}
      {frequency && hasRows && (
        <div className="frequency-table-wrap">
          <table className="frequency-table">
            <thead>
              <tr>
                <th>词语</th>
                <th>词频（TF）</th>
                <th>文档频率（DF）</th>
                <th>文档覆盖率</th>
                <th>标准化词频（每万词，RF10K）</th>
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
                        onClick={() => onAddCandidate(row.token)}
                      >
                        加入停用词
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
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
  const [frequencyStatus, setFrequencyStatus] =
    useState<FrequencyStatus>("idle");
  const [frequencyError, setFrequencyError] = useState<string | null>(null);
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
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(
    null,
  );
  const [activeBatchRequestId, setActiveBatchRequestId] = useState<
    string | null
  >(null);
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
  const [batchFailures, setBatchFailures] = useState<
    Array<{ documentId: string; filename: string; message: string }>
  >([]);
  const [batchReprocessKind, setBatchReprocessKind] = useState<
    "clean" | "tokenize" | null
  >(null);
  const appliedAdditions = stopwordProfile?.custom_additions ?? [];
  const appliedExclusions = stopwordProfile?.custom_exclusions ?? [];
  const hasPendingStopwordChanges = Boolean(
    stopwordProfile &&
    (stopwordBase !== stopwordProfile.base_profile_id ||
      !sameStringSet(stopwordAdditions, appliedAdditions) ||
      !sameStringSet(stopwordExclusions, appliedExclusions)),
  );
  const pendingStopwordCount = stopwordProfile
    ? Number(stopwordBase !== stopwordProfile.base_profile_id) +
      stopwordAdditions.filter((word) => !appliedAdditions.includes(word))
        .length +
      appliedAdditions.filter((word) => !stopwordAdditions.includes(word))
        .length +
      stopwordExclusions.filter((word) => !appliedExclusions.includes(word))
        .length +
      appliedExclusions.filter((word) => !stopwordExclusions.includes(word))
        .length
    : 0;

  useEffect(() => {
    if (!desktopRuntime) return;
    void invoke<E2ePaths>("e2e_paths")
      .then((paths) => setE2ePaths(paths))
      .catch(() => undefined)
      .finally(() => setDesktopReady(true));
  }, [desktopRuntime]);

  useEffect(() => {
    if (!desktopRuntime) return;
    let unlisten: (() => void) | undefined;
    void listen<{
      request_id: string;
      progress: { current: number; total: number; message: string };
    }>("engine-progress", (event) => {
      setBatchProgress({
        requestId: event.payload.request_id,
        current: event.payload.progress.current,
        total: event.payload.progress.total,
        message: event.payload.progress.message,
      });
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => unlisten?.();
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
        dictionary_id:
          userDictionary?.dictionary_id ??
          detail.tokenization_manifest?.user_dictionary_id ??
          null,
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
      setFrequency(null);
      setFrequencyStatus("idle");
      await refreshProjectAfterBatch();
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
      setFrequency(null);
      setFrequencyStatus("idle");
      await refreshProjectAfterBatch();
    } catch (error) {
      setNotice(`无法执行分词：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function executeFrequency(usePersistedProfile = false) {
    if (!project || busy) return;
    setFrequencyStatus("running");
    setFrequencyError(null);
    setBusy(true);
    try {
      const message = await invoke<EngineMessage<FrequencyResult>>(
        "frequency_analyze",
        {
          requestId: requestId("frequency"),
          projectPath: project.project_path,
          profileConfig: usePersistedProfile
            ? null
            : {
                base_profile_id:
                  stopwordProfile?.base_profile_id ?? "scope-cn-general-v1",
                custom_additions: stopwordProfile?.custom_additions ?? [],
                custom_exclusions: stopwordProfile?.custom_exclusions ?? [],
              },
        },
      );
      if (message.type === "error" || !message.result) {
        const reason = engineError(message, "未知错误");
        setFrequencyStatus("error");
        setFrequencyError(`词频分析失败：${reason}`);
        setNotice(`无法计算词频：${reason}`);
        return;
      }
      if (
        !Array.isArray(message.result.rows) ||
        !message.result.manifest ||
        !message.result.profile
      ) {
        setFrequencyStatus("error");
        setFrequencyError("词频分析失败：引擎返回了无法显示的结果。");
        setNotice("无法计算词频：引擎返回了无法显示的结果。");
        return;
      }
      setFrequency(message.result);
      setFrequencyStatus("success");
      setFrequencyError(null);
      setStopwordProfile(message.result.profile);
      setNotice(
        `词频分析完成：${message.result.manifest.included_document_count} / ${documents.length} 篇文档参与统计`,
      );
    } catch (error) {
      setFrequencyStatus("error");
      setFrequencyError("词频分析请求失败，请重试。");
      setNotice(`无法计算词频：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyStopwordChanges(
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
      setIgnoredCandidates([]);
      setFrequency(null);
      setNotice("停用词修改已应用，正在重新计算词频；现有分词结果不会改变。");
    } catch (error) {
      setNotice(`无法保存停用词配置：${String(error)}`);
      return;
    } finally {
      setBusy(false);
    }
    await executeFrequency(true);
  }

  function addStopword() {
    const word = stopwordInput.trim();
    if (!word || stopwordAdditions.includes(word)) return;
    setStopwordInput("");
    setStopwordAdditions((current) => [...current, word]);
    setStopwordExclusions((current) => current.filter((item) => item !== word));
    setNotice(`已加入待处理停用词：${word}`);
  }

  function keepStopword(word: string) {
    if (stopwordExclusions.includes(word)) return;
    setStopwordExclusions((current) => [...current, word]);
    setStopwordAdditions((current) => current.filter((item) => item !== word));
    setIgnoredCandidates((current) => current.filter((item) => item !== word));
    setNotice(`待保留：${word}`);
  }

  function addCandidate(word: string) {
    if (stopwordAdditions.includes(word)) return;
    setStopwordAdditions((current) => [...current, word]);
    setStopwordExclusions((current) => current.filter((item) => item !== word));
    setIgnoredCandidates((current) => current.filter((item) => item !== word));
    setNotice(`已加入待处理停用词：${word}`);
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
    setStopwordAdditions((current) => [
      ...new Set([...current, ...message.result!.words]),
    ]);
    setNotice(`已导入 ${message.result.words.length} 个待处理停用词`);
  }

  async function exportFrequency(format: "csv" | "xlsx") {
    if (
      !project ||
      !frequency ||
      busy ||
      !desktopRuntime ||
      hasPendingStopwordChanges
    )
      return;
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
      setTokens([]);
      setTokenizationManifest(null);
      setFrequency(null);
      setFrequencyStatus("idle");
      await refreshProjectAfterBatch();
    } catch (error) {
      setNotice(`无法执行清洗：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshProjectAfterBatch() {
    if (!project) return;
    const refreshed = await invoke<EngineMessage<ProjectResult>>(
      "project_open",
      {
        requestId: requestId("project-refresh"),
        projectPath: project.project_path,
      },
    );
    if (refreshed.type === "result" && refreshed.result) {
      setProject(refreshed.result.project);
      setDocuments(refreshed.result.documents);
      if (selectedDocument) {
        const detail = await invoke<
          EngineMessage<{ document: DocumentDetail }>
        >("document_get", {
          requestId: requestId("document-refresh"),
          projectPath: project.project_path,
          documentId: selectedDocument.document_id,
        });
        if (detail.type === "result" && detail.result) {
          setSelectedDocument(detail.result.document);
          setTokens(detail.result.document.tokens ?? []);
          setTokenizationManifest(
            detail.result.document.tokenization_manifest ?? null,
          );
        }
      }
    }
  }

  async function executeBatch(
    kind: "clean" | "tokenize",
    reprocessAll: boolean,
  ) {
    if (!project || busy) return;
    const batchRequestId = requestId(`batch-${kind}`);
    setActiveBatchRequestId(batchRequestId);
    setBatchProgress({
      requestId: batchRequestId,
      current: 0,
      total: 0,
      message: kind === "clean" ? "正在准备批量清洗…" : "正在准备批量分词…",
    });
    setBatchSummary(null);
    setBatchFailures([]);
    setBusy(true);
    try {
      const message = await invoke<EngineMessage<BatchResult>>(
        kind === "clean" ? "text_clean_batch" : "text_tokenize_batch",
        {
          requestId: batchRequestId,
          projectPath: project.project_path,
          ...(kind === "clean"
            ? { rules: cleaningRules }
            : { config: tokenizationConfig }),
          reprocessAll,
        },
      );
      if (message.type === "error" || !message.result) {
        setBatchSummary(
          `${kind === "clean" ? "批量清洗" : "批量分词"}失败：${engineError(message, "未知错误")}`,
        );
        return;
      }
      const result = message.result;
      const skipped = result.skipped_missing_analysis_text_count ?? 0;
      setBatchFailures(
        result.entries
          .filter((entry) => entry.status === "failed")
          .map((entry) => ({
            documentId: entry.document_id,
            filename: entry.filename,
            message:
              (entry.error && errorMessages[entry.error.code]) ??
              entry.error?.message ??
              "未知错误",
          })),
      );
      setBatchSummary(
        `${result.cancelled ? "已取消；" : "已完成；"}成功 ${result.succeeded_count} 篇，失败 ${result.failed_count} 篇${skipped ? `，跳过未清洗 ${skipped} 篇` : ""}。`,
      );
      setProject(result.project);
      if (result.succeeded_count > 0) {
        setFrequency(null);
        setFrequencyStatus("idle");
      }
      await refreshProjectAfterBatch();
      setNotice(
        `${kind === "clean" ? "批量清洗" : "批量分词"}${result.cancelled ? "已取消，已完成部分已保存" : "已完成"}`,
      );
    } catch (error) {
      setBatchSummary(`批处理请求失败：${String(error)}`);
    } finally {
      setBusy(false);
      setActiveBatchRequestId(null);
    }
  }

  async function cancelBatch() {
    if (!activeBatchRequestId) return;
    await invoke("request_cancel", {
      requestId: requestId("batch-cancel"),
      targetRequestId: activeBatchRequestId,
    });
    setNotice("已请求取消；当前文档完成后停止，已完成结果会保留。");
  }

  function renderFrequencyWorkspace() {
    return (
      <FrequencyWorkspace
        frequency={frequency}
        status={frequencyStatus}
        error={frequencyError}
        busy={busy}
        stopwordLoadError={stopwordLoadError}
        stopwordOptions={stopwordOptions}
        stopwordProfile={stopwordProfile}
        stopwordBase={stopwordBase}
        stopwordAdditions={stopwordAdditions}
        stopwordExclusions={stopwordExclusions}
        stopwordInput={stopwordInput}
        showResolvedStopwords={showResolvedStopwords}
        showOptimization={showOptimization}
        sortKey={sortKey}
        topN={topN}
        ignoredCandidates={ignoredCandidates}
        documentCount={documents.length}
        hasPendingChanges={hasPendingStopwordChanges}
        pendingCount={pendingStopwordCount}
        onExecute={() => void executeFrequency()}
        onRetryStopword={retryStopwordLoading}
        onResolve={(base) => {
          if (base) {
            setStopwordBase(base);
            setNotice("停用词方案已加入待处理修改，应用后将重新计算词频。");
          }
        }}
        onImport={() => void importStopwords()}
        onInputChange={setStopwordInput}
        onAdd={addStopword}
        onReset={() => {
          setStopwordBase("scope-cn-general-v1");
          setStopwordAdditions([]);
          setStopwordExclusions([]);
          setIgnoredCandidates([]);
          setNotice("默认停用词配置已加入待处理修改。");
        }}
        onToggleResolved={() => setShowResolvedStopwords((value) => !value)}
        onToggleOptimization={() => setShowOptimization((value) => !value)}
        onSortChange={setSortKey}
        onTopNChange={setTopN}
        onAddCandidate={addCandidate}
        onKeep={keepStopword}
        onIgnore={(word) =>
          setIgnoredCandidates((current) => [...new Set([...current, word])])
        }
        onExport={(format) => void exportFrequency(format)}
        onApplyChanges={() => void applyStopwordChanges()}
        onUndoAddition={(word) =>
          setStopwordAdditions((current) =>
            current.filter((item) => item !== word),
          )
        }
        onUndoExclusion={(word) =>
          setStopwordExclusions((current) =>
            current.filter((item) => item !== word),
          )
        }
        onUndoIgnore={(word) =>
          setIgnoredCandidates((current) =>
            current.filter((item) => item !== word),
          )
        }
      />
    );
  }

  function closeProject() {
    setProject(null);
    setDocuments([]);
    setSelectedDocument(null);
    setFrequency(null);
    setFrequencyStatus("idle");
    setFrequencyError(null);
    setBatchProgress(null);
    setBatchSummary(null);
    setBatchFailures([]);
    setBatchReprocessKind(null);
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
          <small>
            篇文档 · 已清洗 {project.cleaned_count ?? 0} · 已分词{" "}
            {project.tokenized_count ?? 0}
          </small>
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
          {workspaceTab === "cleaning" && (
            <div className="batch-toolbar" aria-label="批量清洗">
              <div>
                <strong>项目批量清洗</strong>
                <span>
                  默认处理尚未清洗的文档：
                  {Math.max(
                    0,
                    project.document_count - (project.cleaned_count ?? 0),
                  )}{" "}
                  / {project.document_count} 篇
                </span>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void executeBatch("clean", false)}
              >
                批量清洗
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setBatchReprocessKind("clean")}
              >
                重新清洗全部文档
              </button>
            </div>
          )}
          {workspaceTab === "tokenize" && (
            <div className="batch-toolbar" aria-label="批量分词">
              <div>
                <strong>项目批量分词</strong>
                <span>
                  默认处理已清洗但尚未分词的文档：
                  {Math.max(
                    0,
                    (project.cleaned_count ?? 0) -
                      (project.tokenized_count ?? 0),
                  )}{" "}
                  / {project.document_count} 篇
                </span>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void executeBatch("tokenize", false)}
              >
                批量分词
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setBatchReprocessKind("tokenize")}
              >
                重新分词全部已清洗文档
              </button>
            </div>
          )}
          {batchReprocessKind === "clean" && workspaceTab === "cleaning" && (
            <div className="batch-confirmation" role="alert">
              <span>
                重新清洗将更新分析文本，并使这些文档现有分词及下游分析结果失效。原始文本不会修改。
              </span>
              <button
                className="primary-button"
                onClick={() => {
                  setBatchReprocessKind(null);
                  void executeBatch("clean", true);
                }}
              >
                确认重新清洗
              </button>
              <button
                className="text-button"
                onClick={() => setBatchReprocessKind(null)}
              >
                取消
              </button>
            </div>
          )}
          {batchReprocessKind === "tokenize" && workspaceTab === "tokenize" && (
            <div className="batch-confirmation" role="alert">
              <span>
                重新分词会替换现有 token 结果，并使词频等下游分析失效。
              </span>
              <button
                className="primary-button"
                onClick={() => {
                  setBatchReprocessKind(null);
                  void executeBatch("tokenize", true);
                }}
              >
                确认重新分词
              </button>
              <button
                className="text-button"
                onClick={() => setBatchReprocessKind(null)}
              >
                取消
              </button>
            </div>
          )}
          {activeBatchRequestId &&
            batchProgress?.requestId === activeBatchRequestId && (
              <div className="batch-progress" role="status">
                <span>{batchProgress.message}</span>
                <progress
                  value={batchProgress.current}
                  max={batchProgress.total || 1}
                />
                <button
                  className="text-button"
                  onClick={() => void cancelBatch()}
                >
                  取消
                </button>
              </div>
            )}
          {batchSummary &&
            (workspaceTab === "cleaning" || workspaceTab === "tokenize") && (
              <p className="batch-summary" aria-live="polite">
                {batchSummary}
              </p>
            )}
          {batchFailures.length > 0 &&
            (workspaceTab === "cleaning" || workspaceTab === "tokenize") && (
              <ul className="batch-failures" aria-label="批处理失败文档">
                {batchFailures.map((failure) => (
                  <li key={failure.documentId}>
                    <strong>{failure.filename}</strong>：{failure.message}
                  </li>
                ))}
              </ul>
            )}
          {workspaceTab === "frequency" ? (
            renderFrequencyWorkspace()
          ) : selectedDocument ? (
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
    </main>
  );
}

export default App;
