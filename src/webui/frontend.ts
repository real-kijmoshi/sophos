// ── WebUI Frontend ─────────────────────────────────────────────────────────────
// Embedded HTML/CSS/JS single-page app for the Sophos WebUI.
// Layout mirrors the TUI: phases+tasks on the left, live token stream on the
// right, steering bar at the bottom.

export function getFrontendHTML(): string {
  const css = getCSS();
  const html = getBodyHTML();
  const js = getJS();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sophos — WebUI</title>
<style>${css}</style>
</head>
<body>
${html}
<script>${js}</script>
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
  --green:    #a6e3a1;
}
* { margin:0; padding:0; box-sizing:border-box; }
html, body {
  height: 100%;
  font-family: 'Cascadia Code','SF Mono','Fira Code','JetBrains Mono',monospace;
  background: var(--bg); color: var(--text);
  font-size: 12px; overflow: hidden;
}

/* ── Header ── */
#header {
  height: 36px; flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 10px;
  padding: 0 14px;
  background: var(--bg2);
}
#header .logo { font-size: 13px; font-weight: 700; color: var(--accent); letter-spacing: 1px; }
#header .ver  { color: var(--dim); font-size: 10px; }
.ws-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--dim); }
.ws-dot.on  { background: var(--success); box-shadow: 0 0 6px var(--success); }
.ws-dot.off { background: var(--error); }
#conn-label { font-size: 10px; color: var(--muted); }
.sep { color: var(--dim); }

/* model badges */
.model-badge {
  font-size: 9px; padding: 1px 6px; border-radius: 3px;
  background: var(--surface); color: var(--muted);
  border: 1px solid var(--border); white-space: nowrap;
}
.model-badge .role { color: var(--dim); margin-right: 3px; }
#header .spacer { flex: 1; }

/* ── Main body: left + right ── */
#body {
  display: flex; flex-direction: row;
  height: calc(100vh - 36px - 42px);
  overflow: hidden;
}

/* ── Left column ── */
#left-col {
  width: 42%; min-width: 300px;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--border);
  overflow: hidden;
}

/* Input area */
#input-area {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  padding: 8px 10px; display: flex; gap: 6px;
  background: var(--bg2);
}
#request-input {
  flex: 1; background: var(--surface); border: 1px solid var(--border);
  color: var(--text); font-family: inherit; font-size: 12px;
  resize: none; outline: none; border-radius: 4px;
  padding: 5px 8px; min-height: 32px; max-height: 80px;
}
#request-input::placeholder { color: var(--dim); }
.btn {
  background: var(--accent); color: var(--bg); border: none; border-radius: 4px;
  padding: 5px 12px; font-family: inherit; font-size: 11px; font-weight: 700;
  cursor: pointer; white-space: nowrap; align-self: flex-end; letter-spacing:.5px;
}
.btn:hover { opacity: 0.88; }
.btn:disabled { opacity: 0.35; cursor: not-allowed; }
.btn.ghost {
  background: var(--surface); color: var(--muted);
  border: 1px solid var(--border); font-weight: 400;
}

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

.phase-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 5px; padding: 7px 10px;
}
.phase-card.running { border-color: var(--warning); }
.phase-card.passed  { border-color: var(--success);  }
.phase-card.failed  { border-color: var(--error);    }

.phase-hdr {
  display: flex; align-items: center; gap: 6px;
}
.phase-icon { font-size: 11px; }
.phase-name { font-weight: 600; font-size: 11px; flex:1; }
.phase-dur  { font-size: 10px; color: var(--dim); }

.phase-lines {
  margin-top: 4px; padding-left: 18px;
  font-size: 10px; color: var(--muted); line-height: 1.6;
  max-height: 72px; overflow: hidden;
}
.phase-lines.open { max-height: 400px; }

/* Task grid */
#tasks-wrap {
  flex-shrink: 0; border-top: 1px solid var(--border);
  max-height: 180px; overflow-y: auto;
}
#tasks-hdr {
  padding: 4px 10px; font-size: 10px; font-weight: 700;
  color: var(--dim); letter-spacing: .5px; text-transform: uppercase;
  background: var(--bg2); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 6px;
}
#task-count { font-size: 9px; color: var(--muted); font-weight: 400; }
#task-grid { display: flex; flex-direction: column; }
.task-row {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 10px; font-size: 10px; border-bottom: 1px solid var(--border);
}
.task-row:last-child { border-bottom: none; }
.task-row .t-id    { color: var(--dim); min-width: 60px; }
.task-row .t-desc  { flex:1; color: var(--muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.task-row .t-badge { font-size: 9px; padding: 1px 5px; border-radius: 3px; white-space: nowrap; }
.t-badge.queue  { background: var(--surface);  color: var(--dim);     }
.t-badge.active { background: #f9e2af22; color: var(--warning);  }
.t-badge.done   { background: #a6e3a122; color: var(--success);  }
.t-badge.failed { background: #f38ba822; color: var(--error);    }
.t-badge.repair { background: #fab38722; color: var(--orange);   }
.task-row .t-rev { font-size: 9px; color: var(--dim); }

/* ── Right column ── */
#right-col {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}

/* Agent roster */
#agent-roster {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
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
.agent-pill .pill-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

/* Stream panel */
#stream-panel {
  flex: 1; overflow: hidden; position: relative;
}
#stream-scroll {
  position: absolute; inset: 0; overflow-y: auto;
  scroll-behavior: auto;
}
#stream-inner {
  padding: 0; font-size: 11px; line-height: 1.65;
  color: var(--text); min-height: 100%;
}

/* Agent session block */
.agent-block {
  border-bottom: 1px solid var(--border);
}
.agent-block-hdr {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 12px; cursor: pointer; user-select: none;
  background: var(--bg2); position: sticky; top: 0; z-index: 1;
}
.agent-block-hdr:hover { background: var(--surface2); }
.agent-block-hdr .ab-arrow { font-size: 9px; color: var(--dim); transition: transform .15s; }
.agent-block-hdr.collapsed .ab-arrow { transform: rotate(-90deg); }
.agent-block-hdr .ab-name  { font-size: 11px; font-weight: 700; color: var(--purple); flex: 1; }
.agent-block-hdr .ab-toks  { font-size: 9px; color: var(--dim); }
.agent-block-hdr .ab-tps   { font-size: 9px; color: var(--warning); min-width: 50px; text-align: right; }
.agent-block-hdr .ab-dur   { font-size: 9px; color: var(--dim); min-width: 40px; text-align: right; }
.agent-block-hdr .ab-badge {
  font-size: 8px; padding: 1px 5px; border-radius: 3px;
  background: #f9e2af22; color: var(--warning); border: 1px solid var(--warning);
}
.agent-block-hdr .ab-badge.done {
  background: #a6e3a122; color: var(--success); border-color: var(--success);
}

/* Token text area */
.agent-block-body {
  padding: 6px 14px 10px 14px;
  white-space: pre-wrap; word-break: break-word;
  overflow: hidden;
}
.agent-block-body.collapsed { display: none; }

/* Syntax coloring in stream */
.tok-kw    { color: var(--purple);  }  /* keywords: function/class/const/let/if */
.tok-str   { color: var(--success); }  /* quoted strings */
.tok-num   { color: var(--orange);  }  /* numbers */
.tok-cmt   { color: var(--dim); font-style: italic; }  /* line comments */
.tok-hdr   { color: var(--accent); font-weight: 700; } /* markdown headers */
.tok-code  { color: var(--info);    }  /* inline code */
.tok-punct { color: var(--muted);   }  /* brackets */
.tok-plain { color: var(--text);    }  /* everything else */

/* Blinking cursor */
.cursor-blink {
  display: inline-block; width: 6px; height: 12px;
  background: var(--accent); vertical-align: middle;
  animation: blink .7s step-end infinite;
  margin-left: 1px;
}
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

/* Scroll-lock indicator */
#scroll-lock-btn {
  position: absolute; bottom: 8px; right: 14px;
  background: var(--surface); border: 1px solid var(--border);
  color: var(--muted); font-size: 10px; padding: 3px 8px;
  border-radius: 4px; cursor: pointer; display: none;
  font-family: inherit;
}
#scroll-lock-btn:hover { background: var(--surface2); color: var(--text); }

/* LLM Stats bar */
#stats-bar {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  padding: 4px 10px; display: flex; gap: 14px; align-items: center;
  background: var(--bg2); font-size: 10px; color: var(--dim);
  flex-wrap: wrap;
}
.stat { display: flex; align-items: center; gap: 4px; }
.stat .sv { color: var(--muted); font-weight: 600; }
.stat .sk { color: var(--dim); }

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
#steering-hint { font-size: 10px; color: var(--dim); white-space: nowrap; }

/* ── Toast ── */
#toast {
  position: fixed; bottom: 52px; right: 14px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 6px; padding: 7px 14px; font-size: 11px; color: var(--text);
  box-shadow: 0 4px 20px #0006;
  transform: translateY(12px); opacity: 0; transition: all .25s ease;
  pointer-events: none; z-index: 100;
}
#toast.show { transform: translateY(0); opacity: 1; }

/* Scrollbar */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

#empty-stream {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; color: var(--dim); font-size: 11px;
  pointer-events: none; z-index: 0;
}
`;
}


// ─────────────────────────────────────────────────────────────────────────────
// HTML body
// ─────────────────────────────────────────────────────────────────────────────
function getBodyHTML(): string {
  return `
<div id="header">
  <span class="logo">&#9670; SOPHOS</span>
  <span class="ver">v3.0</span>
  <span class="sep">|</span>
  <div class="ws-dot" id="conn-dot"></div>
  <span id="conn-label">connecting…</span>
  <span class="sep">|</span>
  <span id="model-badges"></span>
  <div class="spacer"></div>
  <button class="btn ghost" id="cancel-btn" style="display:none" onclick="cancelJob()">&#x25A0; cancel</button>
</div>

<div id="body">
  <!-- Left column -->
  <div id="left-col">
    <div id="input-area">
      <textarea id="request-input" rows="2" placeholder="Describe what you want to build or fix…"></textarea>
      <div style="display:flex;flex-direction:column;gap:4px">
        <button class="btn" id="run-btn" onclick="submitRun(false)">&#9654; Run</button>
        <button class="btn ghost" id="plan-btn" onclick="submitRun(true)">Plan</button>
      </div>
    </div>

    <div id="progress-wrap">
      <span id="elapsed-label">0s</span>
      <div id="progress-track"><div id="progress-fill"></div></div>
      <span id="progress-label">0 / 9</span>
    </div>

    <div id="phases-wrap"></div>

    <div id="tasks-wrap" style="display:none">
      <div id="tasks-hdr">Tasks <span id="task-count"></span></div>
      <div id="task-grid"></div>
    </div>
  </div>

  <!-- Right column -->
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
      <div id="empty-stream">LLM token stream will appear here</div>
    </div>

    <div id="stats-bar">
      <div class="stat"><span class="sk">calls</span><span class="sv" id="stat-calls">0</span></div>
      <div class="stat"><span class="sk">tokens</span><span class="sv" id="stat-tokens">0</span></div>
      <div class="stat"><span class="sk">tok/s</span><span class="sv" id="stat-tps">—</span></div>
      <div class="stat"><span class="sk">active agent</span><span class="sv" id="stat-agent">—</span></div>
    </div>
  </div>
</div>

<!-- Steering / chat footer -->
<div id="footer">
  <span id="steering-prefix">&#10148;</span>
  <input id="steering-input" type="text"
    placeholder="Type a steering note and press Enter to inject mid-run, or start a new request…" />
  <span id="steering-hint" id="steering-hint" style="display:none">&#x21B5; inject</span>
</div>

<div id="toast"></div>
`;
}


// ─────────────────────────────────────────────────────────────────────────────
// JS — part 1: state, WebSocket, message dispatch
// ─────────────────────────────────────────────────────────────────────────────
function getJS(): string {
  return `
'use strict';

// ── State ───────────────────────────────────────────────────────────────────
let ws        = null;
let currentJobId = null;
let running   = false;
let startMs   = 0;

// phases: id → { name, status, lines[], dur? }
const phases  = {};
// tasks:  id → { description, status, reviewers? }
const tasks   = {};
// agents: name → { active: bool, tokens: number }
const agents  = {};

let totalTokens = 0;
let totalCalls  = 0;
let tokenTimes  = [];          // epoch ms of last N tokens for TPS
const TPS_WINDOW_MS = 5000;

let streamAgent  = '';         // agent whose tokens are currently streaming
let streamHasContent = false;

let elapsedTimer = null;

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
  connectWS();
  loadStatus();
  initScrollLock();

  // Enter on input → run; shift+enter = newline
  document.getElementById('request-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitRun(false); }
  });

  // Steering input
  const si = document.getElementById('steering-input');
  si.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      e.preventDefault();
      const note = e.target.value.trim();
      e.target.value = '';
      if (running && currentJobId) {
        sendSteering(note);
      } else {
        // Re-use as a new run request
        document.getElementById('request-input').value = note;
        submitRun(false);
      }
    }
  });
  si.addEventListener('focus',  () => updateSteeringHint());
  si.addEventListener('blur',   () => updateSteeringHint());
  si.addEventListener('input',  () => updateSteeringHint());

  // Elapsed clock
  setInterval(tickElapsed, 500);
}

function updateSteeringHint() {
  const hint = document.getElementById('steering-hint');
  const si   = document.getElementById('steering-input');
  hint.style.display = (si.value.trim()) ? 'inline' : 'none';
  hint.textContent   = running ? '↵ inject' : '↵ run';
}

// ── WebSocket ────────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host + '/ws');
  ws.onopen  = onWSOpen;
  ws.onclose = onWSClose;
  ws.onmessage = e => { try { dispatch(JSON.parse(e.data)); } catch {} };
}

function onWSOpen() {
  setConnDot(true);
  ws.send(JSON.stringify({ type: 'ping' }));
}

function onWSClose() {
  setConnDot(false);
  setTimeout(connectWS, 3000);
}

function setConnDot(on) {
  const d = document.getElementById('conn-dot');
  const l = document.getElementById('conn-label');
  d.className = 'ws-dot ' + (on ? 'on' : 'off');
  l.textContent = on ? 'connected' : 'reconnecting…';
}

function wsSend(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// ── Message dispatch ─────────────────────────────────────────────────────────
function dispatch(msg) {
  switch (msg.type) {
    case 'connected':   break;
    case 'pong':        break;
    case 'job:queued':  onJobQueued(msg);   break;
    case 'job:started': onJobStarted(msg);  break;
    case 'job:completed': onJobDone(msg, true);  break;
    case 'job:failed':    onJobDone(msg, false); break;
    case 'pipeline:event': onPipelineEvent(msg.event); break;
    case 'llm:token':   onToken(msg);  break;
    case 'steering:ack': onSteeringAck(msg); break;
  }
}

// ── API: load status (models) ────────────────────────────────────────────────
async function loadStatus() {
  try {
    const d = await fetch('/api/status').then(r => r.json());
    const m = d.models || {};
    const badges = document.getElementById('model-badges');
    const pairs  = [['planner', m.planner], ['coder', m.coder],
                    ['large', m.large], ['small', m.small]];
    badges.innerHTML = pairs
      .filter(([,v]) => v)
      .map(([k,v]) => \`<span class="model-badge"><span class="role">\${k}</span>\${v}</span>\`)
      .join('');
  } catch {}
}
${getJSPart2()}
${getJSPart3()}
${getJSPart4()}
`;
}


// ─────────────────────────────────────────────────────────────────────────────
// JS — part 2: job lifecycle + pipeline events
// ─────────────────────────────────────────────────────────────────────────────
function getJSPart2(): string {
  return `
// ── Job lifecycle ────────────────────────────────────────────────────────────
function onJobQueued(msg) {
  // If we didn't initiate this job (TUI-originated), reset the UI for it
  const incomingId = msg.job?.id || null;
  if (incomingId && incomingId !== currentJobId) {
    currentJobId = incomingId;
    resetUI(msg.job?.request || '');
  }
}

function onJobStarted(msg) {
  if (msg.jobId && msg.jobId !== currentJobId) {
    currentJobId = msg.jobId;
  }
  running  = true;
  startMs  = Date.now();
  document.getElementById('cancel-btn').style.display = 'inline-block';
  document.getElementById('run-btn').disabled  = true;
  document.getElementById('plan-btn').disabled = true;
  document.getElementById('progress-wrap').style.display = 'flex';
}

// ── Shared UI reset (used by submitRun + onJobQueued for TUI jobs) ────────────
function resetUI(requestText) {
  for (const k of Object.keys(phases))      delete phases[k];
  for (const k of Object.keys(tasks))       delete tasks[k];
  for (const k of Object.keys(agents))      delete agents[k];
  for (const k of Object.keys(agentBlocks)) delete agentBlocks[k];
  totalTokens = 0; totalCalls = 0; tokenTimes = [];
  streamAgent = ''; tokenBuf = '';
  scrollLocked = false;
  document.getElementById('phases-wrap').innerHTML   = '';
  document.getElementById('task-grid').innerHTML     = '';
  document.getElementById('tasks-wrap').style.display  = 'none';
  document.getElementById('stream-inner').innerHTML  = '';
  document.getElementById('empty-stream').style.display = 'flex';
  document.getElementById('scroll-lock-btn').style.display = 'none';
  document.getElementById('progress-wrap').style.display  = 'none';
  document.getElementById('progress-fill').style.width    = '0%';
  document.getElementById('progress-label').textContent   = '0 / 9';
  document.getElementById('elapsed-label').textContent    = '0s';
  if (requestText) document.getElementById('request-input').value = requestText;
  renderAgentPills(); updateStats();
}

function onJobDone(msg, success) {
  running = false;
  // flush any remaining token buffer
  if (tokenBuf) { flushBuffer(); }
  document.getElementById('cancel-btn').style.display = 'none';
  document.getElementById('run-btn').disabled  = false;
  document.getElementById('plan-btn').disabled = false;
  // finalize all agent blocks
  for (const name of Object.keys(agents)) {
    agents[name].active = false;
    finalizeAgentBlock(name);
  }
  renderAgentPills();
  if (success) {
    toast('Pipeline complete ✓', true);
    if (msg.summary) appendStreamBlock('[SUMMARY] ' + msg.summary, 'var(--success)');
  } else {
    toast('Pipeline failed — ' + (msg.error || 'unknown'), false);
  }
  updateStats();
}

function onSteeringAck(msg) {
  toast('Steering injected ✓', true);
  appendStreamBlock('[STEERING] ' + msg.note, 'var(--warning)');
}

// ── Pipeline events ──────────────────────────────────────────────────────────
function onPipelineEvent(evt) {
  switch (evt.type) {
    case 'phase:start':
      phases[evt.phaseId] = { name: evt.phaseName, status: 'running', lines: [], startMs: Date.now() };
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
        phases[evt.phaseId].dur = evt.durationMs;
        renderPhases();
      }
      updateProgress();
      break;
    case 'phase:fail':
      if (phases[evt.phaseId]) {
        phases[evt.phaseId].status = 'failed';
        phases[evt.phaseId].dur = evt.durationMs;
        renderPhases();
      }
      updateProgress();
      break;
    case 'task:update':
      handleTaskUpdate(evt);
      break;
    case 'pipeline:done':
      // handled by job:completed / job:failed
      break;
  }
}

function handleTaskUpdate(evt) {
  if (!tasks[evt.id]) {
    tasks[evt.id] = { description: evt.description || evt.id, status: evt.status };
  } else {
    if (evt.description) tasks[evt.id].description = evt.description;
    tasks[evt.id].status = evt.status;
    if (evt.reviewers) tasks[evt.id].reviewers = evt.reviewers;
  }
  renderTasks();
}

// ── LLM token streaming ──────────────────────────────────────────────────────
// Buffer tokens and flush to DOM every FLUSH_MS to avoid 30 DOM ops/sec.
const FLUSH_MS    = 40;
let tokenBuf      = '';     // raw text waiting to flush
let flushTimer    = null;

function onToken(msg) {
  const { chunk, agentName } = msg;
  if (!chunk) return;

  // ── stats bookkeeping ────────────────────────────────────────────────────
  totalTokens++;
  const now = Date.now();
  tokenTimes.push(now);
  // prune outside window
  const cutoff = now - TPS_WINDOW_MS;
  let i = 0;
  while (i < tokenTimes.length && tokenTimes[i] < cutoff) i++;
  if (i > 0) tokenTimes.splice(0, i);

  // ── agent tracking ───────────────────────────────────────────────────────
  if (!agents[agentName]) {
    agents[agentName] = { active: true, tokens: 0, startMs: now, tps: 0 };
  }
  const ag = agents[agentName];
  ag.active = true;
  ag.tokens++;

  // ── agent-block management ───────────────────────────────────────────────
  if (agentName !== streamAgent) {
    // flush previous buffer before switching agent
    if (tokenBuf) { flushBuffer(); }
    streamAgent = agentName;
    openAgentBlock(agentName);
  }

  tokenBuf += chunk;
  if (!flushTimer) {
    flushTimer = setTimeout(() => { flushBuffer(); flushTimer = null; }, FLUSH_MS);
  }

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
// ── Render phases ────────────────────────────────────────────────────────────
const PHASE_ICON = { pending:'○', running:'◐', passed:'●', failed:'✕' };
const PHASE_COLOR = {
  pending: 'var(--dim)',
  running: 'var(--warning)',
  passed:  'var(--success)',
  failed:  'var(--error)',
};

function renderPhases() {
  const wrap = document.getElementById('phases-wrap');
  let html = '';
  for (const id of Object.keys(phases)) {
    const p = phases[id];
    const icon  = PHASE_ICON[p.status]  || '○';
    const color = PHASE_COLOR[p.status] || 'var(--dim)';
    const dur   = p.dur ? fmtDur(p.dur) : (p.status === 'running' ? fmtDur(Date.now() - p.startMs) : '');
    const lines = p.lines.slice(-6)
      .map(l => '<div>' + esc(l) + '</div>').join('');
    const openCls = p.status === 'running' ? ' open' : '';
    html +=
      '<div class="phase-card ' + p.status + '">' +
        '<div class="phase-hdr">' +
          '<span class="phase-icon" style="color:' + color + '">' + icon + '</span>' +
          '<span class="phase-name">' + esc(p.name) + '</span>' +
          '<span class="phase-dur">' + dur + '</span>' +
        '</div>' +
        (lines ? '<div class="phase-lines' + openCls + '">' + lines + '</div>' : '') +
      '</div>';
  }
  wrap.innerHTML = html;
  // auto-scroll to the bottom phase only if already at bottom
  const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
  if (atBottom) wrap.scrollTop = wrap.scrollHeight;
}

// ── Render tasks ─────────────────────────────────────────────────────────────
function renderTasks() {
  const ids  = Object.keys(tasks);
  if (!ids.length) return;
  document.getElementById('tasks-wrap').style.display = 'block';
  document.getElementById('task-count').textContent = '(' + ids.length + ')';
  const grid = document.getElementById('task-grid');
  grid.innerHTML = ids.map(id => {
    const t  = tasks[id];
    const badge = '<span class="t-badge ' + t.status + '">' + t.status + '</span>';
    const rev   = t.reviewers ? '<span class="t-rev">' + esc(t.reviewers) + '</span>' : '';
    return '<div class="task-row">' +
      '<span class="t-id">' + esc(id) + '</span>' +
      '<span class="t-desc">' + esc(t.description) + '</span>' +
      badge + rev +
    '</div>';
  }).join('');
}

// ── Render agent pills ───────────────────────────────────────────────────────
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
    const pill = document.createElement('span');
    pill.className = 'agent-pill ' + cls;
    const tps = ag.startMs && ag.active
      ? Math.round((ag.tokens / Math.max(1, Date.now() - ag.startMs)) * 1000)
      : 0;
    pill.innerHTML =
      '<span class="pill-dot"></span>' + esc(name) +
      ' <span style="opacity:.6;font-size:9px">' + fmtNum(ag.tokens) +
      (tps > 0 ? ' · ' + tps + 't/s' : '') + '</span>';
    roster.appendChild(pill);
  }
}

// ── Progress ─────────────────────────────────────────────────────────────────
const TOTAL_PHASES = 9;
function updateProgress() {
  const done = Object.values(phases).filter(p => p.status === 'passed').length;
  document.getElementById('progress-fill').style.width = Math.round(done / TOTAL_PHASES * 100) + '%';
  document.getElementById('progress-label').textContent = done + ' / ' + TOTAL_PHASES;
}

// ── Stats bar ────────────────────────────────────────────────────────────────
function updateStats() {
  const windowToks = tokenTimes.length;
  const tps = windowToks > 1
    ? Math.round((windowToks / TPS_WINDOW_MS) * 1000)
    : 0;
  document.getElementById('stat-calls').textContent  = fmtNum(totalCalls);
  document.getElementById('stat-tokens').textContent = fmtNum(totalTokens);
  document.getElementById('stat-tps').textContent    = tps > 0 ? tps : '—';
  document.getElementById('stat-agent').textContent  = streamAgent || '—';
}

// ── Elapsed clock ────────────────────────────────────────────────────────────
function tickElapsed() {
  if (!running || !startMs) return;
  document.getElementById('elapsed-label').textContent = fmtDur(Date.now() - startMs);
  renderAgentPills();
  const cutoff = Date.now() - TPS_WINDOW_MS;
  let i = 0;
  while (i < tokenTimes.length && tokenTimes[i] < cutoff) i++;
  if (i > 0) { tokenTimes.splice(0, i); updateStats(); }
}

// ── Agent blocks ─────────────────────────────────────────────────────────────
// Each agent gets one collapsible block. Tokens are appended inside it.
// agentBlocks: name → { bodyEl, hdrEl, textNode (raw accumulated text) }
const agentBlocks = {};

function openAgentBlock(name) {
  const si    = document.getElementById('stream-inner');
  const ag    = agents[name];

  const block = document.createElement('div');
  block.className = 'agent-block';
  block.dataset.agent = name;

  const hdr = document.createElement('div');
  hdr.className = 'agent-block-hdr';
  hdr.innerHTML =
    '<span class="ab-arrow">▼</span>' +
    '<span class="ab-name">▸ ' + esc(name) + '</span>' +
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

  agentBlocks[name] = { blockEl: block, hdrEl: hdr, bodyEl: body, rawText: '', startMs: Date.now() };
  scrollStream();
}

function toggleAgentBlock(name) {
  const ab = agentBlocks[name];
  if (!ab) return;
  const hdr  = ab.hdrEl;
  const body = ab.bodyEl;
  const collapsed = body.classList.toggle('collapsed');
  hdr.classList.toggle('collapsed', collapsed);
}

function writeTokensToBlock(name, text) {
  const ab = agentBlocks[name];
  if (!ab) return;

  ab.rawText += text;

  // Update header stats
  const ag = agents[name];
  const hdr = ab.hdrEl;
  hdr.querySelector('.ab-toks').textContent = fmtNum(ag.tokens) + ' tok';
  const elapsed = Date.now() - ab.startMs;
  hdr.querySelector('.ab-dur').textContent  = fmtDur(elapsed);
  const tps = elapsed > 500 ? Math.round((ag.tokens / elapsed) * 1000) : 0;
  hdr.querySelector('.ab-tps').textContent  = tps > 0 ? tps + ' t/s' : '';

  // Syntax-highlight and append
  const frag = colorize(text);
  // remove cursor, append, re-add cursor
  const cur = ab.bodyEl.querySelector('.cursor-blink');
  if (cur) cur.remove();
  ab.bodyEl.appendChild(frag);
  const cursor = document.createElement('span');
  cursor.className = 'cursor-blink';
  ab.bodyEl.appendChild(cursor);

  scrollStream();
}

function finalizeAgentBlock(name) {
  const ab = agentBlocks[name];
  if (!ab) return;
  // remove cursor
  ab.bodyEl.querySelectorAll('.cursor-blink').forEach(el => el.remove());
  // update badge
  const badge = ab.hdrEl.querySelector('.ab-badge');
  badge.textContent = 'done';
  badge.className   = 'ab-badge done';
  // final timing
  const elapsed = Date.now() - ab.startMs;
  ab.hdrEl.querySelector('.ab-dur').textContent = fmtDur(elapsed);
  const ag = agents[name];
  if (ag) {
    const tps = elapsed > 0 ? Math.round((ag.tokens / elapsed) * 1000) : 0;
    ab.hdrEl.querySelector('.ab-tps').textContent = tps > 0 ? tps + ' t/s' : '';
  }
}

// ── Syntax colorizer ──────────────────────────────────────────────────────────
// Lightweight tokenizer — no deps, handles the patterns LLMs typically emit.
const KW_RE = new RegExp(
  '(' +
  '\`\`\`[\\\\s\\\\S]*?\`\`\`' + '|' +
  '\`[^\`\\\\n]+\`' + '|' +
  '"(?:[^"\\\\\\\\]|\\\\\\\\.)*"' + '|' +
  "'(?:[^'\\\\\\\\]|\\\\\\\\.)*'" + '|' +
  '\\/\\/[^\\\\n]*' + '|' +
  '#{1,3} [^\\\\n]+' + '|' +
  '\\\\b(?:function|const|let|var|class|return|if|else|for|while|import|export|async|await|throw|new|true|false|null|undefined)\\\\b' + '|' +
  '\\\\b\\\\d+(?:\\\\.\\\\d+)?\\\\b' + '|' +
  '[{}\\\\[\\\\]()]' +
  ')', 'g');

function colorize(text) {
  const frag  = document.createDocumentFragment();
  const parts = text.split(KW_RE);
  for (const part of parts) {
    if (!part) continue;
    const span = document.createElement('span');
    span.textContent = part;
    if (part.startsWith('\`\`\`')) {
      span.className = 'tok-code';
    } else if (part.startsWith('\`')) {
      span.className = 'tok-code';
    } else if (part.startsWith('"') || part.startsWith("'")) {
      span.className = 'tok-str';
    } else if (part.startsWith('//')) {
      span.className = 'tok-cmt';
    } else if (/^#{1,3} /.test(part)) {
      span.className = 'tok-hdr';
    } else if (/^(function|const|let|var|class|return|if|else|for|while|import|export|async|await|throw|new|true|false|null|undefined)$/.test(part)) {
      span.className = 'tok-kw';
    } else if (/^[0-9]/.test(part)) {
      span.className = 'tok-num';
    } else if (part === '{' || part === '}' || part === '[' || part === ']' || part === '(' || part === ')') {
      span.className = 'tok-punct';
    } else {
      span.className = 'tok-plain';
    }
    frag.appendChild(span);
  }
  return frag;
}

// ── Scroll management ─────────────────────────────────────────────────────────
let scrollLocked = false;  // true when user has scrolled up

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

// ── appendStreamBlock (phase events / steering) ───────────────────────────────
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

function removeCursor() {
  document.getElementById('stream-inner')
    .querySelectorAll('.cursor-blink')
    .forEach(el => el.remove());
}
`;
}


// ─────────────────────────────────────────────────────────────────────────────
// JS — part 4: actions, utilities
// ─────────────────────────────────────────────────────────────────────────────
function getJSPart4(): string {
  return `
// ── Actions ──────────────────────────────────────────────────────────────────
async function submitRun(planOnly) {
  const input = document.getElementById('request-input');
  const req   = input.value.trim();
  if (!req) { input.focus(); return; }

  // Reset state
  for (const k of Object.keys(phases))      delete phases[k];
  for (const k of Object.keys(tasks))       delete tasks[k];
  for (const k of Object.keys(agents))      delete agents[k];
  for (const k of Object.keys(agentBlocks)) delete agentBlocks[k];
  totalTokens = 0; totalCalls = 0; tokenTimes = [];
  streamAgent = ''; streamHasContent = false; tokenBuf = '';
  scrollLocked = false;
  document.getElementById('phases-wrap').innerHTML  = '';
  document.getElementById('task-grid').innerHTML    = '';
  document.getElementById('tasks-wrap').style.display = 'none';
  document.getElementById('stream-inner').innerHTML = '';
  document.getElementById('empty-stream').style.display = 'flex';
  document.getElementById('scroll-lock-btn').style.display = 'none';
  document.getElementById('progress-wrap').style.display = 'none';
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-label').textContent = '0 / 9';
  document.getElementById('elapsed-label').textContent  = '0s';
  renderAgentPills(); updateStats();

  running = true;
  startMs = Date.now();
  input.value = '';
  document.getElementById('run-btn').disabled  = true;
  document.getElementById('plan-btn').disabled = true;
  document.getElementById('cancel-btn').style.display = 'inline-block';
  document.getElementById('progress-wrap').style.display = 'flex';

  try {
    const resp = await fetch('/api/run', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ request: req, plan_only: !!planOnly }),
    });
    const data = await resp.json();
    if (data.error) {
      toast('Error: ' + data.error, false);
      onJobDone({}, false);
    } else {
      currentJobId = data.jobId;
    }
  } catch (err) {
    toast('Network error', false);
    onJobDone({}, false);
  }
}

function cancelJob() {
  if (!currentJobId) return;
  wsSend({ type: 'cancel', jobId: currentJobId });
  toast('Cancelling…', null);
}

function sendSteering(note) {
  if (!currentJobId) return;
  wsSend({ type: 'steering', jobId: currentJobId, note });
  toast('Injecting: "' + note.slice(0, 40) + '…"', null);
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

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

function toast(msg, ok) {
  const el = document.getElementById('toast');
  el.textContent = ok === true ? '✓ ' + msg : ok === false ? '✕ ' + msg : msg;
  el.style.borderColor = ok === true ? 'var(--success)' : ok === false ? 'var(--error)' : 'var(--warning)';
  el.className = 'toast show';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.className = 'toast', 4000);
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
init();
`;
}
