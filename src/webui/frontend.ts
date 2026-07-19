// ── WebUI Frontend ─────────────────────────────────────────────────────────────
// Embedded HTML/CSS/JS single-page app for the Sophos WebUI.
// Layout: history sidebar on the far left, phases+tasks in the centre-left,
// live token stream on the right, steering bar at the bottom.

export function getFrontendHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Sophos — WebUI</title>
<style>${getCSS()}</style>
</head>
<body>
${getBodyHTML()}
<script>${getJS()}</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────
function getCSS(): string {
  return `
:root {
  --bg:       #1e1e2e;
  --bg2:      #181825;
  --surface:  #313244;
  --surface2: #292940;
  --border:   #45475a;
  --text:     #cdd6f4;
  --muted:    #a6adc8;
  --dim:      #585b70;
  --accent:   #89b4fa;
  --success:  #a6e3a1;
  --warning:  #f9e2af;
  --error:    #f38ba8;
  --info:     #89dceb;
  --orange:   #fab387;
  --purple:   #cba6f7;
  --pink:     #f5c2e7;
}
* { margin:0; padding:0; box-sizing:border-box; }
html, body {
  height: 100%; width: 100%;
  font-family: 'Cascadia Code','SF Mono','Fira Code','JetBrains Mono',monospace;
  background: var(--bg); color: var(--text);
  font-size: 12px; overflow: hidden;
}

/* ── App shell ── */
#app { display:flex; flex-direction:column; height:100vh; overflow:hidden; }

/* ── Header ── */
#header {
  height: 36px; flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 10px;
  padding: 0 12px;
  background: var(--bg2);
}
.logo { font-size: 13px; font-weight: 700; color: var(--accent); letter-spacing: 1px; }
.ver  { color: var(--dim); font-size: 10px; }
.ws-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--dim); }
.ws-dot.on  { background: var(--success); box-shadow: 0 0 6px var(--success); }
.ws-dot.off { background: var(--error); }
.ws-dot.reconnecting { background: var(--warning); animation: pulse .8s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
#conn-label { font-size: 10px; color: var(--muted); }
.sep { color: var(--dim); }
.model-badge {
  font-size: 9px; padding: 1px 6px; border-radius: 3px;
  background: var(--surface); color: var(--muted);
  border: 1px solid var(--border); white-space: nowrap;
}
.model-badge .role { color: var(--dim); margin-right: 3px; }
/* skeleton shimmer while loading */
.model-badge.skeleton {
  color: transparent; background: var(--surface);
  border-color: var(--surface2); animation: shimmer 1.2s linear infinite;
  background: linear-gradient(90deg, var(--surface) 25%, var(--surface2) 50%, var(--surface) 75%);
  background-size: 200% 100%;
}
@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
#header .spacer { flex: 1; }
#ollama-status {
  font-size: 10px; padding: 1px 7px; border-radius: 3px;
  background: var(--surface); border: 1px solid var(--border);
}
#ollama-status.ok   { color: var(--success); border-color: var(--success); background: #a6e3a111; }
#ollama-status.fail { color: var(--error);   border-color: var(--error);   background: #f38ba811; }
#ollama-status.checking { color: var(--dim); }

/* ── Body row (sidebar + main) ── */
#body {
  display: flex; flex-direction: row;
  flex: 1; min-height: 0; overflow: hidden;
}

/* ── History sidebar ── */
#history-sidebar {
  width: 200px; flex-shrink: 0;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--bg2);
  overflow: hidden;
  transition: width .2s ease;
}
#history-sidebar.collapsed { width: 0; }
#history-hdr {
  padding: 5px 10px; font-size: 10px; font-weight: 700; color: var(--dim);
  letter-spacing: .5px; text-transform: uppercase;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
}
#history-hdr .hh-spacer { flex:1; }
#history-list {
  flex: 1; overflow-y: auto;
}
.hist-item {
  padding: 6px 10px; cursor: pointer;
  border-bottom: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 2px;
}
.hist-item:hover { background: var(--surface2); }
.hist-item.active { background: var(--surface); border-left: 2px solid var(--accent); }
.hist-item .hi-req {
  font-size: 10px; color: var(--text); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 170px;
}
.hist-item .hi-meta { font-size: 9px; color: var(--dim); display: flex; gap: 6px; }
.hist-item .hi-status { font-size: 9px; }
.hi-status.done   { color: var(--success); }
.hi-status.failed { color: var(--error); }
.hi-status.running{ color: var(--warning); }
.hist-empty { padding: 12px 10px; font-size: 10px; color: var(--dim); text-align:center; }

/* ── Resize handle ── */
.resize-handle {
  width: 4px; flex-shrink: 0; cursor: col-resize;
  background: transparent; transition: background .15s;
  position: relative; z-index: 10;
}
.resize-handle:hover, .resize-handle.dragging { background: var(--accent); }

/* ── Left column (input + phases + tasks) ── */
#left-col {
  width: 380px; min-width: 240px;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--border);
  overflow: hidden;
}

/* Input area */
#input-area {
  flex-shrink: 0; padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  display: flex; flex-direction: column; gap: 5px;
}
#target-row {
  display: flex; align-items: center; gap: 5px;
}
#target-label { font-size: 10px; color: var(--dim); white-space: nowrap; }
#target-input {
  flex: 1; background: var(--surface); border: 1px solid var(--border);
  color: var(--muted); font-family: inherit; font-size: 10px;
  outline: none; border-radius: 3px; padding: 3px 6px;
}
#target-input:focus { border-color: var(--accent); color: var(--text); }
#target-input::placeholder { color: var(--dim); }
#request-row { display: flex; gap: 6px; }
#request-input {
  flex: 1; background: var(--surface); border: 1px solid var(--border);
  color: var(--text); font-family: inherit; font-size: 12px;
  resize: none; outline: none; border-radius: 4px;
  padding: 5px 8px; min-height: 32px; max-height: 80px;
}
#request-input:focus { border-color: var(--accent); }
#request-input::placeholder { color: var(--dim); }
.btn-col { display: flex; flex-direction: column; gap: 4px; }
.btn {
  background: var(--accent); color: var(--bg); border: none; border-radius: 4px;
  padding: 5px 12px; font-family: inherit; font-size: 11px; font-weight: 700;
  cursor: pointer; white-space: nowrap; letter-spacing:.5px;
}
.btn:hover { opacity: 0.88; }
.btn:disabled { opacity: 0.35; cursor: not-allowed; }
.btn.ghost {
  background: var(--surface); color: var(--muted);
  border: 1px solid var(--border); font-weight: 400;
}
.btn.danger {
  background: #f38ba822; color: var(--error);
  border: 1px solid var(--error); font-weight: 700;
}

/* Autocomplete dropdown */
#autocomplete-list {
  position: absolute; z-index: 200;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 4px; max-height: 160px; overflow-y: auto;
  box-shadow: 0 6px 20px #0008; display: none;
}
.ac-item {
  padding: 5px 10px; font-size: 11px; color: var(--muted); cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ac-item:hover, .ac-item.selected { background: var(--surface2); color: var(--text); }

/* Progress bar */
#progress-wrap {
  flex-shrink: 0; padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  display: none; align-items: center; gap: 8px;
  background: var(--bg2);
}
#progress-track { flex:1; height:3px; background:var(--border); border-radius:2px; overflow:hidden; }
#progress-fill { height:100%; background:var(--accent); border-radius:2px; width:0%; transition:width .4s ease; }
#progress-label { color:var(--muted); font-size:10px; min-width:60px; text-align:right; }
#elapsed-label  { color:var(--dim); font-size:10px; }

/* Phase list */
#phases-wrap {
  flex: 1; overflow-y: auto; padding: 6px;
  display: flex; flex-direction: column; gap: 4px;
}

/* Empty/idle state */
#idle-state {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 14px; padding: 20px; text-align: center;
}
#idle-state .idle-title { font-size: 13px; color: var(--muted); font-weight: 600; }
#idle-state .idle-sub   { font-size: 10px; color: var(--dim); }
#idle-state .kbd-hints  { display: flex; flex-direction: column; gap: 5px; }
.kbd-row { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--dim); }
kbd {
  background: var(--surface); border: 1px solid var(--border); border-radius: 3px;
  padding: 1px 5px; font-family: inherit; font-size: 10px; color: var(--muted);
  min-width: 22px; text-align: center;
}

.phase-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 5px; overflow: hidden;
}
.phase-card.running { border-color: var(--warning); }
.phase-card.passed  { border-color: var(--success); }
.phase-card.failed  { border-color: var(--error); }

.phase-hdr {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; cursor: pointer; user-select: none;
}
.phase-hdr:hover { background: var(--surface2); }
.phase-num  { font-size: 9px; color: var(--dim); min-width: 16px; text-align: right; }
.phase-icon { font-size: 11px; }
.phase-name { font-weight: 600; font-size: 11px; flex:1; }
.phase-dur  { font-size: 10px; color: var(--dim); }
.phase-arrow { font-size: 9px; color: var(--dim); transition: transform .15s; }
.phase-arrow.open { transform: rotate(90deg); }

.phase-lines {
  padding: 0 10px 6px 40px;
  font-size: 10px; color: var(--muted); line-height: 1.6;
  border-top: 1px solid var(--border);
  display: none;
}
.phase-lines.open { display: block; }

/* Task grid */
#tasks-wrap {
  flex-shrink: 0; border-top: 1px solid var(--border);
  max-height: 180px; overflow-y: auto;
}
#tasks-hdr {
  padding: 4px 10px; font-size: 10px; font-weight: 700;
  color: var(--dim); letter-spacing: .5px; text-transform: uppercase;
  background: var(--bg2); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 6px; position: sticky; top: 0;
}
#task-count { font-size: 9px; color: var(--muted); font-weight: 400; }
.task-row {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 10px; font-size: 10px; border-bottom: 1px solid var(--border);
}
.task-row:last-child { border-bottom: none; }
.t-id    { color: var(--dim); min-width: 60px; }
.t-desc  { flex:1; color: var(--muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.t-badge { font-size: 9px; padding: 1px 5px; border-radius: 3px; white-space: nowrap; }
.t-badge.queue  { background: var(--surface);  color: var(--dim);    }
.t-badge.active { background: #f9e2af22; color: var(--warning); }
.t-badge.done   { background: #a6e3a122; color: var(--success); }
.t-badge.failed { background: #f38ba822; color: var(--error);   }
.t-badge.repair { background: #fab38722; color: var(--orange);  }
.t-rev { font-size: 9px; color: var(--dim); }
.t-effort {
  font-size: 9px; padding: 1px 5px; border-radius: 3px; white-space: nowrap;
  background: var(--surface); color: var(--dim);
}
.t-effort:has(+ .t-badge.active) { color: var(--warning); background: #f9e2af15; }

/* ── Right column ── */
#right-col {
  flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0;
}

/* Agent roster */
#agent-roster {
  flex-shrink: 0; border-bottom: 1px solid var(--border);
  padding: 4px 10px; min-height: 28px;
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  background: var(--bg2);
}
#roster-label { font-size: 10px; color: var(--dim); letter-spacing:.5px; text-transform:uppercase; margin-right:4px; }
.agent-pill {
  font-size: 10px; padding: 1px 8px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--muted); display: flex; align-items: center; gap: 4px;
  transition: all .15s;
}
.agent-pill.active { border-color: var(--warning); color: var(--warning); background: #f9e2af14; }
.agent-pill.done   { border-color: var(--success); color: var(--success); background: #a6e3a114; opacity: .6; }
.pill-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

/* Stream panel */
#stream-panel { flex: 1; overflow: hidden; position: relative; }
#stream-scroll { position: absolute; inset: 0; overflow-y: auto; scroll-behavior: auto; }
#stream-inner  {
  padding: 0; font-size: 11px; line-height: 1.65;
  color: var(--text); min-height: 100%;
}

/* Agent session block */
.agent-block { border-bottom: 1px solid var(--border); }
.agent-block-hdr {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 12px; cursor: pointer; user-select: none;
  background: var(--bg2); position: sticky; top: 0; z-index: 1;
}
.agent-block-hdr:hover { background: var(--surface2); }
.ab-arrow { font-size: 9px; color: var(--dim); transition: transform .15s; }
.agent-block-hdr.collapsed .ab-arrow { transform: rotate(-90deg); }
.ab-name  { font-size: 11px; font-weight: 700; color: var(--purple); flex: 1; }
.ab-toks  { font-size: 9px; color: var(--dim); }
.ab-tps   { font-size: 9px; color: var(--warning); min-width: 50px; text-align: right; }
.ab-dur   { font-size: 9px; color: var(--dim); min-width: 40px; text-align: right; }
.ab-badge {
  font-size: 8px; padding: 1px 5px; border-radius: 3px;
  background: #f9e2af22; color: var(--warning); border: 1px solid var(--warning);
}
.ab-badge.done { background: #a6e3a122; color: var(--success); border-color: var(--success); }

.agent-block-body {
  padding: 6px 14px 10px 14px;
  white-space: pre-wrap; word-break: break-word; overflow: hidden;
}
.agent-block-body.collapsed { display: none; }

/* Syntax colouring */
.tok-kw    { color: var(--purple);  }
.tok-str   { color: var(--success); }
.tok-num   { color: var(--orange);  }
.tok-cmt   { color: var(--dim); font-style: italic; }
.tok-hdr   { color: var(--accent); font-weight: 700; }
.tok-code  { color: var(--info);    }
.tok-punct { color: var(--muted);   }
.tok-plain { color: var(--text);    }

/* Blinking cursor */
.cursor-blink {
  display: inline-block; width: 6px; height: 12px;
  background: var(--accent); vertical-align: middle;
  animation: blink .7s step-end infinite; margin-left: 1px;
}
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

/* Scroll-lock indicator */
#scroll-lock-btn {
  position: absolute; bottom: 8px; right: 14px;
  background: var(--surface); border: 1px solid var(--border);
  color: var(--muted); font-size: 10px; padding: 3px 8px;
  border-radius: 4px; cursor: pointer; display: none; font-family: inherit;
}
#scroll-lock-btn:hover { background: var(--surface2); color: var(--text); }

/* Empty stream */
#empty-stream {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: var(--dim); font-size: 11px; gap: 10px;
  pointer-events: none; z-index: 0;
}
#empty-stream .es-icon { font-size: 28px; opacity: .3; }
#empty-stream .es-text { opacity: .6; }
#empty-stream .es-hint { font-size: 10px; opacity: .4; }

/* LLM Stats bar */
#stats-bar {
  flex-shrink: 0; border-top: 1px solid var(--border);
  padding: 4px 10px; display: flex; gap: 14px; align-items: center;
  background: var(--bg2); font-size: 10px; color: var(--dim); flex-wrap: wrap;
}
.stat { display: flex; align-items: center; gap: 4px; }
.sv { color: var(--muted); font-weight: 600; }
.sk { color: var(--dim); }

/* ── Footer: steering bar ── */
#footer {
  height: 42px; flex-shrink: 0;
  border-top: 1px solid var(--border);
  display: flex; align-items: center; gap: 8px;
  padding: 0 10px; background: var(--bg2);
}
#steering-prefix { font-size: 11px; color: var(--dim); white-space: nowrap; }
#steering-input {
  flex: 1; background: transparent; border: none; outline: none;
  color: var(--muted); font-family: inherit; font-size: 11px;
}
#steering-input::placeholder { color: var(--dim); }
#steering-input:focus { color: var(--text); }
#footer-shortcuts { font-size: 10px; color: var(--dim); display: flex; gap: 8px; white-space: nowrap; flex-shrink: 0; }
#footer-shortcuts kbd { font-size: 9px; }

/* ── Toasts ── */
#toast-container {
  position: fixed; top: 44px; right: 14px; z-index: 300;
  display: flex; flex-direction: column; gap: 6px; pointer-events: none;
}
.toast-item {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 6px; padding: 7px 14px; font-size: 11px; color: var(--text);
  box-shadow: 0 4px 20px #0006;
  transform: translateX(20px); opacity: 0;
  transition: all .2s ease; pointer-events: none; max-width: 280px;
}
.toast-item.show { transform: translateX(0); opacity: 1; }
.toast-item.ok   { border-color: var(--success); }
.toast-item.err  { border-color: var(--error); }
.toast-item.warn { border-color: var(--warning); }

/* ── Responsive ── */
@media (max-width: 760px) {
  #history-sidebar { display: none; }
  #left-col { width: 100%; border-right: none; }
  #right-col { display: none; }
  body.show-stream #left-col  { display: none; }
  body.show-stream #right-col { display: flex; flex: 1; }
  #mobile-tab-bar { display: flex !important; }
}
#mobile-tab-bar {
  display: none; position: fixed; bottom: 42px; left: 0; right: 0;
  background: var(--bg2); border-top: 1px solid var(--border);
  z-index: 50; height: 36px;
}
.mtab {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: var(--muted); cursor: pointer; gap: 5px;
}
.mtab.active { color: var(--accent); border-bottom: 2px solid var(--accent); }

/* Scrollbar */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ── Focus visible ── */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
`;
}


// ─────────────────────────────────────────────────────────────────────────────
// HTML body
// ─────────────────────────────────────────────────────────────────────────────
function getBodyHTML(): string {
  return `
<div id="app">

  <!-- Header -->
  <div id="header" role="banner">
    <span class="logo">&#9670; SOPHOS</span>
    <span class="ver" id="version-label">v3.2</span>
    <span class="sep" aria-hidden="true">|</span>
    <div class="ws-dot" id="conn-dot" role="status" aria-label="connection status"></div>
    <span id="conn-label">connecting…</span>
    <span class="sep" aria-hidden="true">|</span>
    <span id="ollama-status" class="checking" role="status">Ollama…</span>
    <span class="sep" aria-hidden="true">|</span>
    <span id="model-badges"></span>
    <div class="spacer"></div>
    <button class="btn danger" id="cancel-btn" style="display:none" onclick="cancelJob()" aria-label="Cancel running job">&#x25A0; cancel</button>
  </div>

  <!-- Body row -->
  <div id="body">

    <!-- History sidebar -->
    <div id="history-sidebar">
      <div id="history-hdr">
        History
        <span class="hh-spacer"></span>
      </div>
      <div id="history-list">
        <div class="hist-empty">No runs yet</div>
      </div>
    </div>

    <div class="resize-handle" id="rh-history" title="Drag to resize"></div>

    <!-- Left column: input + phases + tasks -->
    <div id="left-col">
      <div id="input-area">
        <div id="target-row">
          <span id="target-label">dir:</span>
          <input id="target-input" type="text" placeholder="target directory (default: server cwd)" autocomplete="off" spellcheck="false" />
        </div>
        <div id="request-row">
          <textarea id="request-input" rows="2" placeholder="Describe what you want to build or fix… (Enter to run, Shift+Enter for newline)" autocomplete="off"></textarea>
          <div class="btn-col">
            <button class="btn" id="run-btn" onclick="submitRun(false)">&#9654; Run</button>
            <button class="btn ghost" id="plan-btn" onclick="submitRun(true)">Plan</button>
          </div>
        </div>
        <div id="autocomplete-list"></div>
      </div>

      <div id="progress-wrap" role="progressbar" aria-label="Pipeline progress" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
        <span id="elapsed-label">0s</span>
        <div id="progress-track"><div id="progress-fill"></div></div>
        <span id="progress-label">0 / —</span>
      </div>

      <div id="phases-wrap" aria-live="polite" aria-relevant="additions">
        <!-- idle state shown when no run is active -->
        <div id="idle-state">
          <div class="idle-title">Ready</div>
          <div class="idle-sub">Type a request above and press Run</div>
          <div class="kbd-hints">
            <div class="kbd-row"><kbd>Enter</kbd> <span>Run pipeline</span></div>
            <div class="kbd-row"><kbd>&#8679; Enter</kbd> <span>New line</span></div>
            <div class="kbd-row"><kbd>&#8593;</kbd><kbd>&#8595;</kbd> <span>Browse history</span></div>
            <div class="kbd-row"><kbd>Esc</kbd> <span>Clear input</span></div>
          </div>
        </div>
      </div>

      <div id="tasks-wrap" style="display:none">
        <div id="tasks-hdr">Tasks <span id="task-count"></span></div>
        <div id="task-grid"></div>
      </div>
    </div>

    <div class="resize-handle" id="rh-left" title="Drag to resize"></div>

    <!-- Right column: agent roster + stream + stats -->
    <div id="right-col">
      <div id="agent-roster">
        <span id="roster-label">Agents</span>
        <span id="roster-empty" style="font-size:10px;color:var(--dim)">— idle —</span>
      </div>

      <div id="stream-panel">
        <div id="stream-scroll">
          <div id="stream-inner"></div>
        </div>
        <button id="scroll-lock-btn" onclick="resumeScroll()">&#8595; resume scroll</button>
        <div id="empty-stream">
          <div class="es-icon">&#9670;</div>
          <div class="es-text">LLM token stream will appear here</div>
          <div class="es-hint">Start a run to see live agent output</div>
        </div>
      </div>

      <div id="stats-bar">
        <div class="stat"><span class="sk">calls</span><span class="sv" id="stat-calls">0</span></div>
        <div class="stat"><span class="sk">tokens</span><span class="sv" id="stat-tokens">0</span></div>
        <div class="stat"><span class="sk">tok/s</span><span class="sv" id="stat-tps">—</span></div>
        <div class="stat"><span class="sk">agent</span><span class="sv" id="stat-agent">—</span></div>
      </div>
    </div>

  </div><!-- #body -->

  <!-- Footer: steering / new request -->
  <div id="footer">
    <span id="steering-prefix">&#10148;</span>
    <input id="steering-input" type="text"
      placeholder="Inject a mid-run steering note (Enter), or start a new request…" />
    <div id="footer-shortcuts">
      <kbd>^K</kbd> history &nbsp;
      <kbd>^L</kbd> clear
    </div>
  </div>

</div><!-- #app -->

<!-- Mobile tab bar (hidden on desktop) -->
<div id="mobile-tab-bar">
  <div class="mtab active" id="mtab-phases" onclick="mobileTab('phases')">&#9776; Phases</div>
  <div class="mtab" id="mtab-stream" onclick="mobileTab('stream')">&#9654; Stream</div>
</div>

<div id="toast-container"></div>
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// JS — part 1: state, WebSocket (exponential backoff), dispatch
// ─────────────────────────────────────────────────────────────────────────────
function getJS(): string {
  return `
'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let ws             = null;
let wsReconnectMs  = 1000;   // grows exponentially on failure
let wsReconnTimer  = null;
let wsManuallyClosed = false;

let currentJobId   = null;
let running        = false;
let startMs        = 0;

const phases  = {};   // phaseId → { name, num, status, lines[], dur? }
const tasks   = {};   // taskId  → { description, status, reviewers? }
const agents  = {};   // name    → { active, tokens, startMs }

let totalTokens = 0;
let totalCalls  = 0;
let tokenTimes  = [];
const TPS_WINDOW_MS = 5000;

let streamAgent  = '';
let tokenBuf     = '';
let flushTimer   = null;
const FLUSH_MS   = 40;

let scrollLocked = false;

// agentBlocks: name → { blockEl, hdrEl, bodyEl, rawText, startMs }
const agentBlocks = {};

// ── History (localStorage) ───────────────────────────────────────────────────
const HISTORY_KEY = 'sophos_history';
const REQUEST_HIST_KEY = 'sophos_req_history';
const TARGET_KEY  = 'sophos_target';
let jobHistory    = [];       // [{id, request, status, startedAt, targetDir}]
let reqHistory    = [];       // [string] — request strings for autocomplete
let histIdx       = -1;       // arrow-key position in reqHistory

function loadStorage() {
  try { jobHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');  } catch { jobHistory = []; }
  try { reqHistory = JSON.parse(localStorage.getItem(REQUEST_HIST_KEY) || '[]'); } catch { reqHistory = []; }
  const savedTarget = localStorage.getItem(TARGET_KEY);
  if (savedTarget) document.getElementById('target-input').value = savedTarget;
}

function saveJobHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(jobHistory.slice(0, 50))); } catch {}
}

function saveReqHistory() {
  try { localStorage.setItem(REQUEST_HIST_KEY, JSON.stringify(reqHistory.slice(0, 100))); } catch {}
}

function addToReqHistory(req) {
  if (!req) return;
  reqHistory = [req, ...reqHistory.filter(r => r !== req)].slice(0, 100);
  saveReqHistory();
}

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
  loadStorage();
  connectWS();
  loadStatus();
  initScrollLock();
  initResizeHandles();
  renderHistory();

  const ri = document.getElementById('request-input');
  ri.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitRun(false); return; }
    if (e.key === 'Escape') { e.preventDefault(); ri.value = ''; hideAutocomplete(); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); navigateHistory(-1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); navigateHistory(1);  return; }
    if (e.key === 'Tab') { e.preventDefault(); acceptAutocomplete(); return; }
  });
  ri.addEventListener('input', () => { histIdx = -1; showAutocomplete(ri.value); });
  ri.addEventListener('blur',  () => setTimeout(hideAutocomplete, 150));

  const ti = document.getElementById('target-input');
  ti.addEventListener('change', () => {
    localStorage.setItem(TARGET_KEY, ti.value.trim());
  });

  const si = document.getElementById('steering-input');
  si.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      e.preventDefault();
      const note = e.target.value.trim();
      e.target.value = '';
      if (running && currentJobId) sendSteering(note);
      else { ri.value = note; submitRun(false); }
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault(); toggleHistory();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault(); clearStream();
    }
  });

  setInterval(tickElapsed, 500);
}

// ── History navigation (arrow keys in request input) ─────────────────────────
function navigateHistory(dir) {
  if (!reqHistory.length) return;
  histIdx = Math.max(-1, Math.min(reqHistory.length - 1, histIdx + dir));
  const ri = document.getElementById('request-input');
  ri.value = histIdx >= 0 ? reqHistory[histIdx] : '';
  hideAutocomplete();
}

// ── Autocomplete ─────────────────────────────────────────────────────────────
function showAutocomplete(val) {
  const list = document.getElementById('autocomplete-list');
  if (!val || val.length < 2) { hideAutocomplete(); return; }
  const matches = reqHistory.filter(r => r.toLowerCase().includes(val.toLowerCase())).slice(0, 8);
  if (!matches.length) { hideAutocomplete(); return; }
  const ri = document.getElementById('request-input');
  const rect = ri.getBoundingClientRect();
  list.style.display = 'block';
  list.style.position = 'fixed';
  list.style.top  = rect.bottom + 2 + 'px';
  list.style.left = rect.left + 'px';
  list.style.width = rect.width + 'px';
  list.innerHTML = matches.map((m, i) =>
    '<div class="ac-item" data-idx="' + i + '" onmousedown="pickAutocomplete(' + i + ')">' + esc(m) + '</div>'
  ).join('');
}

function hideAutocomplete() {
  document.getElementById('autocomplete-list').style.display = 'none';
}

function acceptAutocomplete() {
  const sel = document.querySelector('.ac-item.selected');
  if (sel) { document.getElementById('request-input').value = sel.textContent; hideAutocomplete(); }
}

function pickAutocomplete(idx) {
  const items = document.querySelectorAll('.ac-item');
  if (items[idx]) { document.getElementById('request-input').value = items[idx].textContent; hideAutocomplete(); }
}

// ── WebSocket with exponential backoff ────────────────────────────────────────
function connectWS() {
  if (wsManuallyClosed) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host + '/ws');

  ws.onopen = () => {
    wsReconnectMs = 1000;   // reset backoff on success
    setConnDot('on');
    ws.send(JSON.stringify({ type: 'ping' }));
    // Re-subscribe to active job if we had one (e.g. after page refresh)
    if (currentJobId && running) {
      ws.send(JSON.stringify({ type: 'subscribe', jobId: currentJobId }));
    }
  };

  ws.onclose = () => {
    setConnDot('reconnecting');
    if (!wsManuallyClosed) scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose fires right after, which handles reconnect
  };

  ws.onmessage = e => {
    try { dispatch(JSON.parse(e.data)); } catch {}
  };
}

function scheduleReconnect() {
  clearTimeout(wsReconnTimer);
  wsReconnTimer = setTimeout(() => {
    connectWS();
    wsReconnectMs = Math.min(wsReconnectMs * 2, 30000);  // cap at 30s
  }, wsReconnectMs);
  document.getElementById('conn-label').textContent = 'reconnecting in ' + (wsReconnectMs / 1000).toFixed(0) + 's…';
}

function setConnDot(state) {
  const d = document.getElementById('conn-dot');
  const l = document.getElementById('conn-label');
  d.className = 'ws-dot ' + state;
  if (state === 'on')           l.textContent = 'connected';
  else if (state === 'off')     l.textContent = 'disconnected';
  else if (state === 'reconnecting') {} // label set by scheduleReconnect
}

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── Message dispatch ──────────────────────────────────────────────────────────
function dispatch(msg) {
  switch (msg.type) {
    case 'connected':        break;
    case 'pong':             break;
    case 'job:queued':       onJobQueued(msg);          break;
    case 'job:started':      onJobStarted(msg);         break;
    case 'job:completed':    onJobDone(msg, true);      break;
    case 'job:failed':       onJobDone(msg, false);     break;
    case 'pipeline:event':   onPipelineEvent(msg.event);break;
    case 'llm:token':        onToken(msg);              break;
    case 'steering:ack':     onSteeringAck(msg);        break;
  }
}

// ── Ollama health check ───────────────────────────────────────────────────────
async function loadStatus() {
  const el = document.getElementById('ollama-status');
  const badges = document.getElementById('model-badges');
  // Show skeletons while loading
  badges.innerHTML = ['planner','coder','large','small'].map(k =>
    '<span class="model-badge skeleton" style="min-width:80px">&nbsp;</span>'
  ).join('');

  try {
    const d = await fetch('/api/status').then(r => r.json());

    // Ollama ping
    try {
      const ollamaUrl = (d.ollama?.url || 'http://localhost:11434') + '/api/tags';
      const ok = await fetch(ollamaUrl, { signal: AbortSignal.timeout(4000) }).then(r => r.ok);
      el.className = ok ? 'ok' : 'fail';
      el.textContent = ok ? 'Ollama ✓' : 'Ollama ✗';
      if (!ok) toast('Ollama is unreachable — check it is running', 'warn');
    } catch {
      el.className = 'fail';
      el.textContent = 'Ollama ✗';
      toast('Ollama unreachable', 'warn');
    }

    // Model badges
    const m = d.models || {};
    const pairs = [['planner',m.planner],['coder',m.coder],['large',m.large],['small',m.small]];
    badges.innerHTML = pairs.filter(([,v]) => v)
      .map(([k,v]) => '<span class="model-badge"><span class="role">' + k + '</span>' + esc(String(v)) + '</span>')
      .join('');
    if (!badges.innerHTML) badges.innerHTML = '<span style="font-size:10px;color:var(--dim)">no models detected</span>';
  } catch {
    el.className = 'fail'; el.textContent = 'status error';
    badges.innerHTML = '';
  }
}

${getJSPart2()}
${getJSPart3()}
${getJSPart4()}
`;
}


// ─────────────────────────────────────────────────────────────────────────────
// JS — part 2: job lifecycle, history, pipeline events
// ─────────────────────────────────────────────────────────────────────────────
function getJSPart2(): string {
  return `
// ── History sidebar ───────────────────────────────────────────────────────────
function renderHistory() {
  const list = document.getElementById('history-list');
  if (!jobHistory.length) {
    list.innerHTML = '<div class="hist-empty">No runs yet</div>';
    return;
  }
  list.innerHTML = jobHistory.map(j => {
    const ago = fmtAgo(j.startedAt);
    const active = j.id === currentJobId ? ' active' : '';
    return '<div class="hist-item' + active + '" onclick="loadHistoryJob(' + JSON.stringify(j.id) + ')">' +
      '<div class="hi-req">' + esc(j.request) + '</div>' +
      '<div class="hi-meta">' +
        '<span>' + ago + '</span>' +
        '<span class="hi-status ' + j.status + '">' + j.status + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function toggleHistory() {
  const sb = document.getElementById('history-sidebar');
  sb.classList.toggle('collapsed');
}

function loadHistoryJob(id) {
  // Load stored request text into the input so user can re-run or inspect
  const j = jobHistory.find(h => h.id === id);
  if (!j) return;
  document.getElementById('request-input').value = j.request;
  if (j.targetDir) document.getElementById('target-input').value = j.targetDir;
  // Highlight in sidebar
  document.querySelectorAll('.hist-item').forEach(el => el.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

// ── Job lifecycle ─────────────────────────────────────────────────────────────
function onJobQueued(msg) {
  const incomingId = msg.job?.id || null;
  if (incomingId && incomingId !== currentJobId) {
    currentJobId = incomingId;
    resetUI(msg.job?.request || '');
  }
  // Upsert into history
  if (incomingId) {
    const existing = jobHistory.find(j => j.id === incomingId);
    if (!existing) {
      jobHistory.unshift({ id: incomingId, request: msg.job?.request || '', status: 'running', startedAt: Date.now(), targetDir: '' });
      saveJobHistory();
      renderHistory();
    }
  }
}

function onJobStarted(msg) {
  if (msg.jobId && msg.jobId !== currentJobId) currentJobId = msg.jobId;
  // Update history entry id if server rekey'd it
  const hist = jobHistory.find(j => j.id === currentJobId);
  if (hist) { hist.status = 'running'; saveJobHistory(); renderHistory(); }

  running = true;
  startMs = Date.now();
  document.getElementById('cancel-btn').style.display   = 'inline-block';
  document.getElementById('run-btn').disabled  = true;
  document.getElementById('plan-btn').disabled = true;
  document.getElementById('progress-wrap').style.display = 'flex';
  document.getElementById('idle-state').style.display    = 'none';
}

function onJobDone(msg, success) {
  running = false;
  if (tokenBuf) flushBuffer();
  document.getElementById('cancel-btn').style.display   = 'none';
  document.getElementById('run-btn').disabled  = false;
  document.getElementById('plan-btn').disabled = false;
  for (const name of Object.keys(agents)) {
    agents[name].active = false;
    finalizeAgentBlock(name);
  }
  renderAgentPills();
  updateStats();

  // Update history
  const hist = jobHistory.find(j => j.id === currentJobId);
  if (hist) {
    hist.status = success ? 'done' : 'failed';
    saveJobHistory();
    renderHistory();
  }

  if (success) {
    toast('Pipeline complete ✓', 'ok');
    if (msg.summary) appendStreamBlock('[SUMMARY] ' + msg.summary, 'var(--success)');
  } else {
    toast('Pipeline failed — ' + (msg.error || 'unknown'), 'err');
  }
}

function onSteeringAck(msg) {
  toast('Steering injected ✓', 'ok');
  appendStreamBlock('[STEERING] ' + msg.note, 'var(--warning)');
}

function resetUI(requestText) {
  for (const k of Object.keys(phases))      delete phases[k];
  for (const k of Object.keys(tasks))       delete tasks[k];
  for (const k of Object.keys(agents))      delete agents[k];
  for (const k of Object.keys(agentBlocks)) delete agentBlocks[k];
  totalTokens = 0; totalCalls = 0; tokenTimes = [];
  streamAgent = ''; tokenBuf = '';
  scrollLocked = false;

  const pw = document.getElementById('phases-wrap');
  pw.innerHTML = '';
  // Re-add idle state div (hidden while running)
  const idle = document.createElement('div');
  idle.id = 'idle-state'; idle.style.display = 'none';
  idle.innerHTML =
    '<div class="idle-title">Ready</div>' +
    '<div class="idle-sub">Type a request above and press Run</div>';
  pw.appendChild(idle);

  document.getElementById('task-grid').innerHTML     = '';
  document.getElementById('tasks-wrap').style.display  = 'none';
  document.getElementById('stream-inner').innerHTML  = '';
  document.getElementById('empty-stream').style.display = 'flex';
  document.getElementById('scroll-lock-btn').style.display = 'none';
  document.getElementById('progress-wrap').style.display  = 'none';
  document.getElementById('progress-fill').style.width    = '0%';
  document.getElementById('progress-label').textContent   = '0 / —';
  document.getElementById('elapsed-label').textContent    = '0s';
  if (requestText) document.getElementById('request-input').value = requestText;
  renderAgentPills(); updateStats();
}

function clearStream() {
  document.getElementById('stream-inner').innerHTML = '';
  document.getElementById('empty-stream').style.display = 'flex';
  for (const k of Object.keys(agentBlocks)) delete agentBlocks[k];
}

// ── Pipeline events ───────────────────────────────────────────────────────────
let phaseCounter = 0;

function onPipelineEvent(evt) {
  if (!evt) return;
  switch (evt.type) {
    case 'phase:start':
      phaseCounter++;
      phases[evt.phaseId] = {
        name: evt.phaseName, num: phaseCounter,
        status: 'running', lines: [], startMs: Date.now(),
        open: true,
      };
      renderPhases();
      break;
    case 'phase:line':
      if (phases[evt.phaseId]) {
        phases[evt.phaseId].lines.push(evt.line);
        renderPhases();
      }
      break;
    case 'phase:done':
      if (phases[evt.phaseId]) {
        phases[evt.phaseId].status = 'passed';
        phases[evt.phaseId].dur    = evt.durationMs;
        phases[evt.phaseId].open   = false;
        renderPhases();
      }
      updateProgress();
      break;
    case 'phase:fail':
      if (phases[evt.phaseId]) {
        phases[evt.phaseId].status = 'failed';
        phases[evt.phaseId].dur    = evt.durationMs;
        phases[evt.phaseId].open   = true;
        renderPhases();
      }
      updateProgress();
      break;
    case 'task:update':
      handleTaskUpdate(evt);
      break;
  }
}

function handleTaskUpdate(evt) {
  if (!tasks[evt.id]) {
    tasks[evt.id] = { description: evt.description || evt.id, status: evt.status, effort: evt.effort || '' };
  } else {
    if (evt.description) tasks[evt.id].description = evt.description;
    tasks[evt.id].status = evt.status;
    if (evt.reviewers) tasks[evt.id].reviewers = evt.reviewers;
    if (evt.effort) tasks[evt.id].effort = evt.effort;
  }
  renderTasks();
}

// ── LLM token streaming ───────────────────────────────────────────────────────
function onToken(msg) {
  const { chunk, agentName } = msg;
  if (!chunk) return;

  totalTokens++;
  const now = Date.now();
  tokenTimes.push(now);
  const cutoff = now - TPS_WINDOW_MS;
  let i = 0;
  while (i < tokenTimes.length && tokenTimes[i] < cutoff) i++;
  if (i > 0) tokenTimes.splice(0, i);

  if (!agents[agentName]) agents[agentName] = { active: true, tokens: 0, startMs: now };
  agents[agentName].active = true;
  agents[agentName].tokens++;

  if (agentName !== streamAgent) {
    if (tokenBuf) flushBuffer();
    streamAgent = agentName;
    totalCalls++;
    openAgentBlock(agentName);
  }

  tokenBuf += chunk;
  if (!flushTimer) flushTimer = setTimeout(() => { flushBuffer(); flushTimer = null; }, FLUSH_MS);

  updateStats();
  renderAgentPills();
  document.getElementById('empty-stream').style.display = 'none';
}

function flushBuffer() {
  if (!tokenBuf || !streamAgent) return;
  const text = tokenBuf;
  tokenBuf = '';
  writeTokensToBlock(streamAgent, text);
}
`;
}


// ─────────────────────────────────────────────────────────────────────────────
// JS — part 3: render helpers
// ─────────────────────────────────────────────────────────────────────────────
function getJSPart3(): string {
  return `
// ── Render phases ─────────────────────────────────────────────────────────────
const PHASE_ICON = { pending:'○', running:'◐', passed:'●', failed:'✕' };
const PHASE_COLOR = {
  pending: 'var(--dim)',
  running: 'var(--warning)',
  passed:  'var(--success)',
  failed:  'var(--error)',
};

function renderPhases() {
  const wrap = document.getElementById('phases-wrap');
  const ids  = Object.keys(phases);
  // Remove old phase cards (leave idle-state div)
  wrap.querySelectorAll('.phase-card').forEach(el => el.remove());

  for (const id of ids) {
    const p     = phases[id];
    const icon  = PHASE_ICON[p.status]  || '○';
    const color = PHASE_COLOR[p.status] || 'var(--dim)';
    const dur   = p.dur ? fmtDur(p.dur)
                        : (p.status === 'running' ? fmtDur(Date.now() - p.startMs) : '');
    const open  = p.open ? ' open' : '';
    const arrowCls = p.open ? ' open' : '';

    // Re-use existing DOM node if present for minimal flicker
    let card = wrap.querySelector('.phase-card[data-id="' + id + '"]');
    if (!card) {
      card = document.createElement('div');
      card.className = 'phase-card ' + p.status;
      card.dataset.id = id;
      card.innerHTML =
        '<div class="phase-hdr" onclick="togglePhase(' + JSON.stringify(id) + ')">' +
          '<span class="phase-num">' + (p.num || '') + '.</span>' +
          '<span class="phase-icon" style="color:' + color + '">' + icon + '</span>' +
          '<span class="phase-name">' + esc(p.name) + '</span>' +
          '<span class="phase-dur">' + dur + '</span>' +
          '<span class="phase-arrow' + arrowCls + '">&#9654;</span>' +
        '</div>' +
        '<div class="phase-lines' + open + '">' +
          p.lines.slice(-12).map(l => '<div>' + esc(l) + '</div>').join('') +
        '</div>';
      wrap.appendChild(card);
    } else {
      // Patch in-place
      card.className = 'phase-card ' + p.status;
      const icon_el  = card.querySelector('.phase-icon');
      if (icon_el) { icon_el.textContent = icon; icon_el.style.color = color; }
      const dur_el   = card.querySelector('.phase-dur');
      if (dur_el)  dur_el.textContent = dur;
      const lines_el = card.querySelector('.phase-lines');
      if (lines_el) {
        lines_el.className = 'phase-lines' + open;
        lines_el.innerHTML = p.lines.slice(-12).map(l => '<div>' + esc(l) + '</div>').join('');
      }
      const arrow_el = card.querySelector('.phase-arrow');
      if (arrow_el) arrow_el.className = 'phase-arrow' + arrowCls;
    }
  }

  // Auto-scroll to bottom of phases if near bottom
  const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
  if (atBottom) wrap.scrollTop = wrap.scrollHeight;
}

function togglePhase(id) {
  if (!phases[id]) return;
  phases[id].open = !phases[id].open;
  renderPhases();
}

// ── Render tasks ──────────────────────────────────────────────────────────────
function renderTasks() {
  const ids = Object.keys(tasks);
  if (!ids.length) return;
  document.getElementById('tasks-wrap').style.display = 'block';
  document.getElementById('task-count').textContent = '(' + ids.length + ')';
  const grid = document.getElementById('task-grid');
  grid.innerHTML = ids.map(id => {
    const t = tasks[id];
    return '<div class="task-row">' +
      '<span class="t-id">' + esc(id) + '</span>' +
      '<span class="t-desc">' + esc(t.description) + '</span>' +
      (t.effort ? '<span class="t-effort">' + esc(t.effort) + '</span>' : '') +
      '<span class="t-badge ' + t.status + '">' + t.status + '</span>' +
      (t.reviewers ? '<span class="t-rev">' + esc(t.reviewers) + '</span>' : '') +
    '</div>';
  }).join('');
}

// ── Render agent pills ────────────────────────────────────────────────────────
function renderAgentPills() {
  const names  = Object.keys(agents);
  const empty  = document.getElementById('roster-empty');
  const roster = document.getElementById('agent-roster');
  roster.querySelectorAll('.agent-pill').forEach(el => el.remove());
  if (!names.length) { empty.style.display = 'inline'; return; }
  empty.style.display = 'none';
  for (const name of names) {
    const ag  = agents[name];
    const cls = ag.active ? 'active' : 'done';
    const tps = ag.startMs && ag.active
      ? Math.round((ag.tokens / Math.max(1, Date.now() - ag.startMs)) * 1000)
      : 0;
    const pill = document.createElement('span');
    pill.className = 'agent-pill ' + cls;
    pill.innerHTML =
      '<span class="pill-dot"></span>' + esc(name) +
      ' <span style="opacity:.6;font-size:9px">' + fmtNum(ag.tokens) +
      (tps > 0 ? ' · ' + tps + 't/s' : '') + '</span>';
    roster.appendChild(pill);
  }
}

// ── Progress ──────────────────────────────────────────────────────────────────
function getTotalPhases(): number {
  const phaseCount = Object.keys(phases).length;
  return phaseCount > 0 ? phaseCount : 9;
}
function updateProgress() {
  const total = getTotalPhases();
  const done = Object.values(phases).filter(p => p.status === 'passed').length;
  document.getElementById('progress-fill').style.width = Math.round(done / total * 100) + '%';
  document.getElementById('progress-label').textContent = done + ' / ' + total;
  const bar = document.getElementById('progress-wrap');
  if (bar) bar.setAttribute('aria-valuenow', String(Math.round(done / total * 100)));
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function updateStats() {
  const windowToks = tokenTimes.length;
  const tps = windowToks > 1 ? Math.round((windowToks / TPS_WINDOW_MS) * 1000) : 0;
  document.getElementById('stat-calls').textContent  = fmtNum(totalCalls);
  document.getElementById('stat-tokens').textContent = fmtNum(totalTokens);
  document.getElementById('stat-tps').textContent    = tps > 0 ? tps : '—';
  document.getElementById('stat-agent').textContent  = streamAgent || '—';
}

// ── Elapsed clock ─────────────────────────────────────────────────────────────
function tickElapsed() {
  if (!running || !startMs) return;
  document.getElementById('elapsed-label').textContent = fmtDur(Date.now() - startMs);
  renderAgentPills();
  const cutoff = Date.now() - TPS_WINDOW_MS;
  let i = 0;
  while (i < tokenTimes.length && tokenTimes[i] < cutoff) i++;
  if (i > 0) { tokenTimes.splice(0, i); updateStats(); }
}

// ── Agent blocks ──────────────────────────────────────────────────────────────
function openAgentBlock(name) {
  const si  = document.getElementById('stream-inner');
  const now = Date.now();
  const block = document.createElement('div');
  block.className = 'agent-block';
  block.dataset.agent = name;

  const hdr = document.createElement('div');
  hdr.className = 'agent-block-hdr';
  hdr.innerHTML =
    '<span class="ab-arrow">&#9660;</span>' +
    '<span class="ab-name">&#9658; ' + esc(name) + '</span>' +
    '<span class="ab-badge">running</span>' +
    '<span class="ab-toks">0 tok</span>' +
    '<span class="ab-tps"></span>' +
    '<span class="ab-dur"></span>';
  hdr.addEventListener('click', () => toggleAgentBlock(name));

  const body = document.createElement('div');
  body.className = 'agent-block-body';

  block.appendChild(hdr);
  block.appendChild(body);
  si.appendChild(block);
  agentBlocks[name] = { blockEl: block, hdrEl: hdr, bodyEl: body, rawText: '', startMs: now };
  scrollStream();
}

function toggleAgentBlock(name) {
  const ab = agentBlocks[name];
  if (!ab) return;
  const collapsed = ab.bodyEl.classList.toggle('collapsed');
  ab.hdrEl.classList.toggle('collapsed', collapsed);
}

function writeTokensToBlock(name, text) {
  const ab = agentBlocks[name];
  if (!ab) return;
  ab.rawText += text;
  const ag  = agents[name];
  const hdr = ab.hdrEl;
  hdr.querySelector('.ab-toks').textContent = fmtNum(ag.tokens) + ' tok';
  const elapsed = Date.now() - ab.startMs;
  hdr.querySelector('.ab-dur').textContent  = fmtDur(elapsed);
  const tps = elapsed > 500 ? Math.round((ag.tokens / elapsed) * 1000) : 0;
  hdr.querySelector('.ab-tps').textContent  = tps > 0 ? tps + ' t/s' : '';

  const cur = ab.bodyEl.querySelector('.cursor-blink');
  if (cur) cur.remove();
  ab.bodyEl.appendChild(colorize(text));
  const cursor = document.createElement('span');
  cursor.className = 'cursor-blink';
  ab.bodyEl.appendChild(cursor);
  scrollStream();
}

function finalizeAgentBlock(name) {
  const ab = agentBlocks[name];
  if (!ab) return;
  ab.bodyEl.querySelectorAll('.cursor-blink').forEach(el => el.remove());
  const badge = ab.hdrEl.querySelector('.ab-badge');
  badge.textContent = 'done'; badge.className = 'ab-badge done';
  const elapsed = Date.now() - ab.startMs;
  ab.hdrEl.querySelector('.ab-dur').textContent = fmtDur(elapsed);
  const ag = agents[name];
  if (ag) {
    const tps = elapsed > 0 ? Math.round((ag.tokens / elapsed) * 1000) : 0;
    ab.hdrEl.querySelector('.ab-tps').textContent = tps > 0 ? tps + ' t/s' : '';
  }
}

// ── Syntax colorizer ──────────────────────────────────────────────────────────
const KW_RE = new RegExp(
  '(' +
  '\`\`\`[\\\\s\\\\S]*?\`\`\`' + '|' +
  '\`[^\`\\\\n]+\`'            + '|' +
  '"(?:[^"\\\\\\\\]|\\\\\\\\.)*"' + '|' +
  "'(?:[^'\\\\\\\\]|\\\\\\\\.)*'" + '|' +
  '\\/\\/[^\\\\n]*'           + '|' +
  '#{1,3} [^\\\\n]+'          + '|' +
  '\\\\b(?:function|const|let|var|class|return|if|else|for|while|import|export|async|await|throw|new|true|false|null|undefined)\\\\b' + '|' +
  '\\\\b\\\\d+(?:\\\\.\\\\d+)?\\\\b' + '|' +
  '[{}\\\\[\\\\]()]' +
  ')', 'g');

function colorize(text) {
  const frag  = document.createDocumentFragment();
  for (const part of text.split(KW_RE)) {
    if (!part) continue;
    const span = document.createElement('span');
    span.textContent = part;
    if (part.startsWith('\`'))               span.className = 'tok-code';
    else if (part.startsWith('"') || part.startsWith("'")) span.className = 'tok-str';
    else if (part.startsWith('//'))          span.className = 'tok-cmt';
    else if (/^#{1,3} /.test(part))          span.className = 'tok-hdr';
    else if (/^(function|const|let|var|class|return|if|else|for|while|import|export|async|await|throw|new|true|false|null|undefined)$/.test(part))
                                             span.className = 'tok-kw';
    else if (/^[0-9]/.test(part))            span.className = 'tok-num';
    else if ('{}[]()'.includes(part))        span.className = 'tok-punct';
    else                                     span.className = 'tok-plain';
    frag.appendChild(span);
  }
  return frag;
}

// ── Scroll management ─────────────────────────────────────────────────────────
function scrollStream() {
  if (scrollLocked) return;
  const el = document.getElementById('stream-scroll');
  el.scrollTop = el.scrollHeight;
}

function resumeScroll() {
  scrollLocked = false;
  document.getElementById('scroll-lock-btn').style.display = 'none';
  scrollStream();
}

function initScrollLock() {
  const el = document.getElementById('stream-scroll');
  el.addEventListener('scroll', () => {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (!atBottom && running) {
      scrollLocked = true;
      document.getElementById('scroll-lock-btn').style.display = 'block';
    } else if (atBottom) {
      scrollLocked = false;
      document.getElementById('scroll-lock-btn').style.display = 'none';
    }
  });
}

function appendStreamBlock(text, color) {
  const si  = document.getElementById('stream-inner');
  const blk = document.createElement('div');
  blk.style.cssText = 'margin:6px 12px;padding:4px 10px;border-left:2px solid ' + color +
    ';color:' + color + ';font-size:10px;white-space:pre-wrap;';
  blk.textContent = text;
  si.appendChild(blk);
  scrollStream();
  document.getElementById('empty-stream').style.display = 'none';
}

// ── Resizable split panes ─────────────────────────────────────────────────────
function initResizeHandles() {
  setupResize('rh-history', 'history-sidebar', 'width', 120, 320);
  setupResize('rh-left',    'left-col',         'width', 200, 600);
}

function setupResize(handleId, targetId, prop, minPx, maxPx) {
  const handle = document.getElementById(handleId);
  const target = document.getElementById(targetId);
  if (!handle || !target) return;
  let startX, startVal;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX   = e.clientX;
    startVal = parseInt(getComputedStyle(target)[prop], 10);
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(e2) {
      const delta = e2.clientX - startX;
      const nv    = Math.max(minPx, Math.min(maxPx, startVal + delta));
      target.style[prop] = nv + 'px';
    }
    function onUp() {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}
`;
}


// ─────────────────────────────────────────────────────────────────────────────
// JS — part 4: actions, utilities, bootstrap
// ─────────────────────────────────────────────────────────────────────────────
function getJSPart4(): string {
  return `
// ── Actions ───────────────────────────────────────────────────────────────────
async function submitRun(planOnly) {
  const ri  = document.getElementById('request-input');
  const req = ri.value.trim();
  if (!req) { ri.focus(); return; }
  hideAutocomplete();

  const targetDir = document.getElementById('target-input').value.trim();

  // Persist to history
  addToReqHistory(req);
  histIdx = -1;

  // Reset UI
  phaseCounter = 0;
  for (const k of Object.keys(phases))      delete phases[k];
  for (const k of Object.keys(tasks))       delete tasks[k];
  for (const k of Object.keys(agents))      delete agents[k];
  for (const k of Object.keys(agentBlocks)) delete agentBlocks[k];
  totalTokens = 0; totalCalls = 0; tokenTimes = [];
  streamAgent = ''; tokenBuf = '';
  scrollLocked = false;

  const pw = document.getElementById('phases-wrap');
  pw.querySelectorAll('.phase-card').forEach(el => el.remove());
  document.getElementById('idle-state').style.display = 'none';

  document.getElementById('task-grid').innerHTML     = '';
  document.getElementById('tasks-wrap').style.display = 'none';
  document.getElementById('stream-inner').innerHTML  = '';
  document.getElementById('empty-stream').style.display = 'flex';
  document.getElementById('scroll-lock-btn').style.display = 'none';
  document.getElementById('progress-wrap').style.display   = 'flex';
  document.getElementById('progress-fill').style.width     = '0%';
  document.getElementById('progress-label').textContent    = '0 / —';
  document.getElementById('elapsed-label').textContent     = '0s';
  renderAgentPills(); updateStats();

  running = true;
  startMs = Date.now();
  ri.value = '';
  document.getElementById('run-btn').disabled  = true;
  document.getElementById('plan-btn').disabled = true;
  document.getElementById('cancel-btn').style.display = 'inline-block';

  try {
    const body = { request: req, plan_only: !!planOnly };
    if (targetDir) body.target_dir = targetDir;
    const resp = await fetch('/api/run', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.error) {
      toast('Error: ' + data.error, 'err');
      onJobDone({}, false);
    } else {
      currentJobId = data.jobId;
      // Upsert into history
      const existing = jobHistory.find(j => j.id === data.jobId);
      if (!existing) {
        jobHistory.unshift({ id: data.jobId, request: req, status: 'running', startedAt: startMs, targetDir });
        saveJobHistory();
        renderHistory();
      }
    }
  } catch (err) {
    toast('Network error', 'err');
    onJobDone({}, false);
  }
}

function cancelJob() {
  if (!currentJobId) return;
  wsSend({ type: 'cancel', jobId: currentJobId });
  toast('Cancelling…', 'warn');
}

function sendSteering(note) {
  if (!currentJobId) return;
  wsSend({ type: 'steering', jobId: currentJobId, note });
  toast('Injecting: "' + note.slice(0, 40) + (note.length > 40 ? '…' : '') + '"', 'warn');
}

// ── Mobile tab switch ─────────────────────────────────────────────────────────
function mobileTab(tab) {
  const isStream = tab === 'stream';
  document.body.classList.toggle('show-stream', isStream);
  document.getElementById('mtab-phases').classList.toggle('active', !isStream);
  document.getElementById('mtab-stream').classList.toggle('active', isStream);
}

// ── Toast notifications (stacked, top-right) ──────────────────────────────────
function toast(msg, type) {   // type: 'ok' | 'err' | 'warn' | null
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  const prefix = type === 'ok' ? '✓ ' : type === 'err' ? '✕ ' : '';
  el.className = 'toast-item ' + (type || '');
  el.textContent = prefix + msg;
  container.appendChild(el);
  // Animate in
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  // Dismiss after 4s
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 4000);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtDur(ms) {
  if (ms < 1000)  return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's';
}

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function fmtAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
init();
`;
}
