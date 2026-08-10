import "./App.css";

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

function App() {
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

      <section className="hero" aria-labelledby="hero-title">
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
