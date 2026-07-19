// ── WebUI Frontend ─────────────────────────────────────────────────────────────
// Embedded HTML/CSS/JS single-page app for the Sophos WebUI.

export function getFrontendHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sophos — WebUI</title>
<style>
  :root {
    --bg: #1e1e2e; --surface: #313244; --border: #45475a;
    --text: #cdd6f4; --muted: #a6adc8; --dim: #585b70;
    --accent: #89b4fa; --success: #a6e3a1; --warning: #f9e2af;
    --error: #f38ba8; --info: #89dceb; --orange: #fab387;
    --purple: #cba6f7; --pink: #f5c2e7;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    background: var(--bg); color: var(--text);
    min-height: 100vh; display: flex; flex-direction: column;
  }
  header {
    border-bottom: 1px solid var(--border);
    padding: 12px 20px; display: flex; align-items: center; gap: 12px;
  }
  header h1 { font-size: 16px; font-weight: 700; color: var(--accent); }
  header .version { font-size: 11px; color: var(--dim); }
  header .status { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .dot.on { background: var(--success); }
  .dot.off { background: var(--error); }

  main { flex: 1; display: flex; flex-direction: column; padding: 16px 20px; gap: 16px; overflow: hidden; }

  /* Input area */
  .input-area {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 12px; display: flex; gap: 8px;
  }
  .input-area textarea {
    flex: 1; background: transparent; border: none; color: var(--text);
    font-family: inherit; font-size: 13px; resize: none; outline: none;
    min-height: 40px; max-height: 120px;
  }
  .input-area textarea::placeholder { color: var(--dim); }
  .btn {
    background: var(--accent); color: var(--bg); border: none; border-radius: 6px;
    padding: 8px 16px; font-family: inherit; font-size: 12px; font-weight: 600;
    cursor: pointer; white-space: nowrap; align-self: flex-end;
  }
  .btn:hover { opacity: 0.9; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.secondary { background: var(--surface); color: var(--muted); border: 1px solid var(--border); }

  /* Pipeline view */
  #pipeline-view {
    flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;
  }

  .phase-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    padding: 10px 14px; font-size: 12px;
  }
  .phase-card.running { border-color: var(--warning); }
  .phase-card.passed { border-color: var(--success); }
  .phase-card.failed { border-color: var(--error); }
  .phase-header {
    display: flex; align-items: center; gap: 8px;
  }
  .phase-icon { font-size: 14px; }
  .phase-name { font-weight: 600; }
  .phase-dur { color: var(--dim); margin-left: auto; }
  .phase-lines {
    margin-top: 6px; padding-left: 22px; color: var(--muted);
    font-size: 11px; line-height: 1.5; max-height: 120px; overflow-y: auto;
  }

  .progress-bar {
    display: flex; align-items: center; gap: 10px; font-size: 12px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    padding: 10px 14px;
  }
  .progress-track {
    flex: 1; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;
  }
  .progress-fill {
    height: 100%; background: var(--accent); border-radius: 3px;
    transition: width 0.3s ease;
  }
  .progress-label { color: var(--muted); min-width: 80px; text-align: right; }

  /* Job history */
  .job-item {
    display: flex; align-items: center; gap: 10px; padding: 8px 12px;
    border-bottom: 1px solid var(--border); font-size: 12px; cursor: pointer;
  }
  .job-item:hover { background: var(--surface); }
  .job-status { font-size: 14px; }
  .job-request { flex: 1; color: var(--text); }
  .job-time { color: var(--dim); }

  /* Diff viewer */
  .diff-view {
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    padding: 10px; font-size: 11px; line-height: 1.5; max-height: 300px;
    overflow-y: auto; white-space: pre-wrap;
  }
  .diff-add { color: var(--success); }
  .diff-del { color: var(--error); }
  .diff-hdr { color: var(--info); }
  .diff-ctx { color: var(--dim); }

  /* Toast */
  .toast {
    position: fixed; bottom: 20px; right: 20px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 16px; font-size: 12px; color: var(--text);
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    transform: translateY(100px); opacity: 0; transition: all 0.3s ease;
  }
  .toast.show { transform: translateY(0); opacity: 1; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
</style>
</head>
<body>
<header>
  <h1>&#9670; SOPHOS</h1>
  <span class="version">v3.0 WebUI</span>
  <div class="status">
    <div class="dot" id="conn-dot"></div>
    <span id="conn-label">connecting...</span>
  </div>
</header>

<main>
  <div class="input-area">
    <textarea id="request-input" placeholder="Describe what you want to build or fix..." rows="2"></textarea>
    <div style="display:flex;flex-direction:column;gap:4px;">
      <button class="btn" id="run-btn" onclick="runPipeline()">Run</button>
      <button class="btn secondary" id="plan-btn" onclick="runPipeline(true)">Plan</button>
    </div>
  </div>

  <div class="progress-bar" id="progress-bar" style="display:none;">
    <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
    <span class="progress-label" id="progress-label">0 / 9</span>
  </div>

  <div id="pipeline-view"></div>

  <div id="job-history" style="display:none;">
    <div style="font-size:11px;color:var(--dim);padding:4px 0;">Recent Jobs</div>
    <div id="job-list"></div>
  </div>
</main>

<div class="toast" id="toast"></div>

<script>
const PHASE_NAMES = [
  'Repository Analysis','Planning Swarm','Execution Planning',
  'Coding Swarm','Multi-Agent Review','Automated Validation',
  'Security Swarm','Integration','Final QA',
];
const ICONS = { pending:'&#9675;', running:'&#9680;', passed:'&#9679;', failed:'&#9679;' };
const COLORS = { pending:'var(--dim)', running:'var(--warning)', passed:'var(--success)', failed:'var(--error)' };

let ws, phases = {}, running = false;

function init() {
  connectWS();
  document.getElementById('request-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runPipeline(); }
  });
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host + '/ws');
  ws.onopen = () => {
    document.getElementById('conn-dot').className = 'dot on';
    document.getElementById('conn-label').textContent = 'connected';
  };
  ws.onclose = () => {
    document.getElementById('conn-dot').className = 'dot off';
    document.getElementById('conn-label').textContent = 'disconnected';
    setTimeout(connectWS, 3000);
  };
  ws.onmessage = e => {
    try { handleMessage(JSON.parse(e.data)); } catch {}
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'pipeline:event':
      handlePipelineEvent(msg.event);
      break;
    case 'job:completed':
      running = false;
      document.getElementById('run-btn').disabled = false;
      document.getElementById('plan-btn').disabled = false;
      toast(msg.success ? 'Pipeline complete' : 'Pipeline failed', msg.success);
      break;
    case 'job:failed':
      running = false;
      document.getElementById('run-btn').disabled = false;
      document.getElementById('plan-btn').disabled = false;
      toast('Pipeline error: ' + (msg.error || 'unknown'), false);
      break;
  }
}

function handlePipelineEvent(evt) {
  const i = PHASE_NAMES.indexOf(evt.phaseName);
  const id = evt.phaseId;

  if (evt.type === 'phase:start') {
    phases[id] = { name: evt.phaseName, status: 'running', lines: [], startMs: Date.now() };
    renderPhases();
  } else if (evt.type === 'phase:line') {
    if (phases[id]) { phases[id].lines.push(evt.line); renderPhases(); }
  } else if (evt.type === 'phase:done') {
    if (phases[id]) { phases[id].status = 'passed'; phases[id].dur = evt.durationMs; renderPhases(); }
  } else if (evt.type === 'phase:fail') {
    if (phases[id]) { phases[id].status = 'failed'; phases[id].dur = evt.durationMs; renderPhases(); }
  }
  updateProgress();
}

function renderPhases() {
  const el = document.getElementById('pipeline-view');
  let html = '';
  for (const id of Object.keys(phases)) {
    const p = phases[id];
    const icon = ICONS[p.status] || ICONS.pending;
    const color = COLORS[p.status] || COLORS.pending;
    const dur = p.dur ? fmtDur(p.dur) : (p.status === 'running' ? fmtDur(Date.now() - p.startMs) : '');
    const lines = p.lines.slice(-5).map(l => '<div>' + escHtml(l) + '</div>').join('');
    html += '<div class="phase-card ' + p.status + '">'
      + '<div class="phase-header">'
      + '<span class="phase-icon" style="color:' + color + '">' + icon + '</span>'
      + '<span class="phase-name">' + escHtml(p.name) + '</span>'
      + '<span class="phase-dur">' + dur + '</span>'
      + '</div>'
      + (lines ? '<div class="phase-lines">' + lines + '</div>' : '')
      + '</div>';
  }
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

function updateProgress() {
  const total = PHASE_NAMES.length;
  const done = Object.values(phases).filter(p => p.status === 'passed').length;
  const bar = document.getElementById('progress-bar');
  const fill = document.getElementById('progress-fill');
  const label = document.getElementById('progress-label');
  bar.style.display = 'flex';
  fill.style.width = Math.round((done / total) * 100) + '%';
  label.textContent = done + ' / ' + total;
}

async function runPipeline(planOnly) {
  const input = document.getElementById('request-input');
  const request = input.value.trim();
  if (!request) return;

  running = true;
  phases = {};
  document.getElementById('run-btn').disabled = true;
  document.getElementById('plan-btn').disabled = true;
  document.getElementById('pipeline-view').innerHTML = '';
  document.getElementById('progress-bar').style.display = 'none';
  input.value = '';

  try {
    const resp = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, plan_only: !!planOnly }),
    });
    const data = await resp.json();
    if (data.error) toast('Error: ' + data.error, false);
  } catch (err) {
    toast('Network error', false);
    running = false;
    document.getElementById('run-btn').disabled = false;
    document.getElementById('plan-btn').disabled = false;
  }
}

function fmtDur(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's';
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toast(msg, ok) {
  const el = document.getElementById('toast');
  el.textContent = (ok ? '\\u2713 ' : '\\u2717 ') + msg;
  el.style.borderColor = ok ? 'var(--success)' : 'var(--error)';
  el.className = 'toast show';
  setTimeout(() => el.className = 'toast', 4000);
}

init();
</script>
</body>
</html>`;
}
