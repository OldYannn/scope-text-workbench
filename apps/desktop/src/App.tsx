import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import "./App.css";

type EngineMessage = {
  request_id: string;
  type: "progress" | "result" | "error";
  progress?: { current: number; total: number; message: string };
  result?: {
    completed_steps?: number;
    engine_version?: string;
    reproducibility_manifest?: Record<string, unknown>;
  };
  error?: { code: string; message: string };
};

type Operation = "idle" | "diagnostic" | "recovery";

const foundations = [
  {
    index: "01",
    title: "Local-first",
    description: "本地分析路径保持离线，用户语料不会因启动应用而离开设备。",
  },
  {
    index: "02",
    title: "Reproducible",
    description: "研究参数、软件版本与输入哈希将进入可追溯的分析记录。",
  },
  {
    index: "03",
    title: "Method-led",
    description: "研究方法先于界面功能，算法与桌面呈现保持清晰边界。",
  },
];

function requestId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function App() {
  const desktopRuntime = isTauri();
  const activeRequestId = useRef<string | null>(null);
  const operationRef = useRef<Operation>("idle");
  const [operation, setOperation] = useState<Operation>("idle");
  const [progress, setProgress] = useState({ current: 0, total: 5 });
  const [status, setStatus] = useState(
    desktopRuntime ? "等待诊断" : "请在 Tauri 桌面窗口中运行",
  );
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(
    null,
  );
  const [engineVersion, setEngineVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!desktopRuntime) return;
    const unlisten = listen<EngineMessage>("engine-progress", ({ payload }) => {
      if (payload.request_id !== activeRequestId.current) return;
      setProgress({
        current: payload.progress?.current ?? 0,
        total: payload.progress?.total ?? 1,
      });
      setStatus(payload.progress?.message ?? "诊断进行中");
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [desktopRuntime]);

  function beginOperation(nextOperation: Exclude<Operation, "idle">) {
    if (operationRef.current !== "idle") return false;
    operationRef.current = nextOperation;
    setOperation(nextOperation);
    return true;
  }

  function endOperation() {
    operationRef.current = "idle";
    setOperation("idle");
  }

  async function runDiagnostic() {
    if (!beginOperation("diagnostic")) return;
    const id = requestId("diagnostic");
    activeRequestId.current = id;
    setManifest(null);
    setProgress({ current: 0, total: 5 });
    setStatus("正在启动 Python 分析引擎…");
    try {
      const message = await invoke<EngineMessage>("diagnostic_run", {
        requestId: id,
        steps: 5,
        delayMs: 1000,
      });
      if (message.type === "result") {
        setManifest(message.result?.reproducibility_manifest ?? null);
        setStatus("诊断完成，已生成可复现清单");
      } else {
        setStatus(
          message.error?.code === "cancelled"
            ? "诊断已安全取消"
            : `诊断失败：${message.error?.message ?? "未知错误"}`,
        );
      }
    } catch (error) {
      setStatus(`无法运行诊断：${String(error)}`);
    } finally {
      activeRequestId.current = null;
      endOperation();
    }
  }

  async function cancelDiagnostic() {
    const targetRequestId = activeRequestId.current;
    if (operationRef.current !== "diagnostic" || !targetRequestId) return;
    setStatus("正在请求安全取消…");
    try {
      await invoke<EngineMessage>("diagnostic_cancel", {
        requestId: requestId("cancel"),
        targetRequestId,
      });
    } catch (error) {
      setStatus(`取消失败：${String(error)}`);
    }
  }

  async function verifyRecovery() {
    if (!beginOperation("recovery")) return;
    setStatus("正在模拟分析引擎异常退出…");
    setManifest(null);
    try {
      const crash = await invoke<EngineMessage>("diagnostic_crash", {
        requestId: requestId("crash"),
      });
      if (crash.error?.code !== "engine_exited") {
        setStatus("异常退出未按预期报告");
        return;
      }
      setStatus("已发现异常，正在用新请求重启引擎…");
      const restarted = await invoke<EngineMessage>("engine_describe", {
        requestId: requestId("recovery"),
      });
      setEngineVersion(restarted.result?.engine_version ?? null);
      setStatus("恢复验证通过：旧请求未重放，新请求已由新进程响应");
    } catch (error) {
      setStatus(`恢复验证失败：${String(error)}`);
    } finally {
      endOperation();
    }
  }

  const progressPercent = Math.round((progress.current / progress.total) * 100);

  return (
    <main className="shell">
      <header className="masthead">
        <div className="brand-lockup" aria-label="SCOPE 文镜">
          <span className="brand">SCOPE</span>
          <span className="brand-cn">文镜</span>
        </div>
        <div className="milestone">
          <span className="status-dot" aria-hidden="true" />
          Milestone 0 · Pre-alpha
        </div>
      </header>

      <section
        className="hero"
        aria-labelledby="hero-title"
        data-testid="scope-hero"
      >
        <p className="eyebrow">
          Humanities &amp; Social Sciences Text Workbench
        </p>
        <h1 id="hero-title">
          让文本研究过程
          <span>清晰、可查、可复现。</span>
        </h1>
        <p className="intro">
          SCOPE 文镜正在建立最小可信技术底座。本阶段只验证桌面壳、Python
          分析引擎边界与跨平台交付，不产生科研分析结论。
        </p>
      </section>

      <section className="diagnostic" aria-labelledby="diagnostic-title">
        <div className="diagnostic-heading">
          <p className="eyebrow">Diagnostic tracer bullet / 基础链路诊断</p>
          <h2 id="diagnostic-title">桌面与分析引擎之间，是否真的可靠？</h2>
          <p>
            这不是研究功能。它只验证进度、取消、异常恢复，以及一次运行所需的可复现记录。
          </p>
        </div>

        <div className="diagnostic-instrument">
          <div
            className="meter"
            aria-label={`诊断进度 ${progressPercent}%`}
            data-testid="diagnostic-progress"
          >
            <span className="meter-value">{progressPercent}</span>
            <span className="meter-unit">%</span>
            <div className="meter-track" aria-hidden="true">
              <span style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
          <p
            className="diagnostic-status"
            aria-live="polite"
            data-testid="diagnostic-status"
          >
            <span aria-hidden="true">STATUS</span>
            {status}
          </p>
          <div className="diagnostic-actions">
            <button
              className="primary-action"
              data-testid="diagnostic-run"
              disabled={!desktopRuntime || operation !== "idle"}
              onClick={() => void runDiagnostic()}
            >
              运行诊断
            </button>
            <button
              data-testid="diagnostic-cancel"
              disabled={operation !== "diagnostic"}
              onClick={() => void cancelDiagnostic()}
            >
              安全取消
            </button>
            <button
              disabled={!desktopRuntime || operation !== "idle"}
              onClick={() => void verifyRecovery()}
            >
              验证异常恢复
            </button>
          </div>
          <div className="manifest-panel">
            <span>Reproducibility manifest / 可复现清单</span>
            <pre data-testid="diagnostic-manifest">
              {manifest
                ? JSON.stringify(manifest, null, 2)
                : "完成一次诊断后，固定参数、软件版本和网络使用状态将在这里显示。"}
            </pre>
          </div>
          {engineVersion && (
            <p className="engine-version">恢复后的引擎版本 {engineVersion}</p>
          )}
        </div>
      </section>

      <section className="foundation-grid" aria-label="Project foundations">
        {foundations.map((foundation) => (
          <article className="foundation" key={foundation.index}>
            <span className="foundation-index">{foundation.index}</span>
            <h2>{foundation.title}</h2>
            <p>{foundation.description}</p>
          </article>
        ))}
      </section>

      <footer className="system-strip" aria-label="Development system status">
        <div>
          <span className="system-label">Desktop</span>
          <strong>Tauri 2 · React · TypeScript</strong>
        </div>
        <div>
          <span className="system-label">Engine contract</span>
          <strong>Python · NDJSON 0.1</strong>
        </div>
        <div>
          <span className="system-label">Network</span>
          <strong>Not required</strong>
        </div>
      </footer>
    </main>
  );
}

export default App;
