# Sophos

> Production-grade multi-agent local coding system powered by Ollama.

Sophos uses locally-running LLMs to analyze codebases, plan implementations, generate code, review it through multiple AI perspectives, run security scans, and produce deliverables. **Entirely local -- no external API keys required.**

## Features

- **Interactive Agent Mode** -- fast tool loop (read, search, edit, run commands) for questions and small tasks, with conversation memory and permission-gated shell access
- **9-Phase Autonomous Pipeline** -- from repository analysis to final QA
- **Multi-Agent Consensus** -- 60% supermajority voting with issue deduplication
- **4 Usage Modes** -- interactive TUI, batch, WebUI, MCP
- **8 Specialized Planning Agents** -- architecture, backend, frontend, database, DevOps, security, performance, infrastructure
- **5 Independent Code Reviewers** -- logic, bugs, architecture, style, performance
- **6 Security Agents** -- auth, injection, secrets, supply chain, business logic, privileges
- **Mid-Run Steering** -- inject notes while the pipeline runs
- **Auto-Tuned Concurrency** -- hardware-aware parallelism based on GPU VRAM
- **Token Streaming** -- live LLM output with automatic retry and abort support
- **5-Layer Config Cascade** -- defaults, global, project, legacy, env vars
- **Full-Screen TUI** -- with live streaming, session tabs, slash commands, and diff viewer

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Ollama](https://ollama.com) running locally (default: `http://localhost:11434`)
- At least one Ollama model pulled (e.g. `ollama pull mistral-nemo:12b`)

## Install

```bash
bun install
```

## Usage

### Interactive TUI (default)

```bash
bun run dev
```

Full-screen terminal UI with live streaming output, session tabs, slash commands, mid-run steering, and git integration. Falls back to a line-based REPL in non-TTY environments (pipes, CI).

Requests route automatically: questions and conversational input go to the **fast agent loop** (reads files, searches, makes surgical edits, runs approved commands, answers with context); explicit build requests ("add X", "implement Y") run the **full 9-phase pipeline**. Force either with `/agent <task>` or `/pipeline <request>`. Mention files with `@path/to/file` to pull them into context (fuzzy completion as you type). While the agent works, typing queues a follow-up; `↑` history persists across restarts.

### Batch Mode

```bash
bun src/index.ts "add user authentication"
bun src/index.ts -t ./my-api "refactor auth middleware"
bun src/index.ts --plan "add rate limiting"       # Analysis only, no file writes
bun src/index.ts --dry-run "add logging"          # Skip code generation
```

### WebUI (browser)

```bash
bun run webui       # http://localhost:3777
bun run tunnel      # WebUI + public tunnel URL
```

### MCP (AI tool integration)

```bash
bun run mcp         # JSON-RPC 2.0 over stdio
```

## CLI Options

| Flag | Short | Description |
|---|---|---|
| `--target <dir>` | `-t` | Target directory (default: cwd) |
| `--request <text>` | `-r` | User request (triggers batch mode) |
| `--config <path>` | `-c` | Config file path |
| `--model <model>` | `-m` | Medium model override |
| `--model-small <model>` | | Small model for quick tasks |
| `--model-medium <model>` | | Medium model |
| `--model-large <model>` | | Large model for complex reasoning |
| `--ollama-url <url>` | | Ollama server URL |
| `--plan` | `-p` | Plan mode (no file writes) |
| `--dry-run` | `-d` | Skip code generation |
| `--verbose` | `-v` | Verbose output |
| `--max-reviews <n>` | | Max review iterations (default: 3) |
| `--max-repairs <n>` | | Max repair attempts (default: 2) |
| `--version` | | Show version |
| `--webui` | | Start WebUI server |
| `--webui-port <port>` | | WebUI port (default: 3777) |
| `--mcp` | | Start MCP server (stdio) |
| `--tunnel` | | Expose WebUI via tunnel |
| `--tunnel-provider <p>` | | Tunnel provider: cloudflared, localtunnel, ngrok, auto |
| `--help` | `-h` | Show help |

Positional arguments (non-flag words) are treated as the request and trigger batch mode automatically.

## 9-Phase Pipeline

| Phase | Name | Agents | Model Tier | Description |
|---|---|---|---|---|
| 1 | Repository Analysis | 1 architect | small | Scans file tree, detects tech stack, architecture, risks |
| 2 | Planning Swarm | 8 planners + synthesizer | large | Parallel specialized planning with consensus merge |
| 3 | Execution Planning | 1 planner | medium | Converts plan into a task graph with dependencies |
| 4 | Coding Swarm | N engineers | medium | Generates production code for each task |
| 5 | Multi-Agent Review | 5 reviewers + synthesizer | medium | Logic, bug, architecture, style, performance review |
| 6 | Automated Validation | -- | small | Runs build, typecheck, lint, and tests |
| 7 | Security Swarm | 6 agents + synthesizer | large | Auth, injection, secrets, supply chain, business logic, privileges |
| 8 | Integration | -- | small | Merges patches, resolves conflicts, integrity checks |
| 9 | Final QA | 1 QA agent | medium | End-to-end validation gate |

The pipeline stops on first failure. Phases 6 and 7 are skippable via config.

## MCP Tools

When running in MCP mode, Sophos exposes these tools:

| Tool | Description |
|---|---|
| `sophos_pipeline` | Run the full 9-phase pipeline on a target directory |
| `sophos_analyze` | Analyze a codebase: detect tech stack, architecture, file structure |
| `sophos_status` | Get Ollama connection status, available models, configuration |
| `sophos_config` | Get or update Sophos configuration |

## Configuration

Sophos uses a 5-layer hierarchical config (later layers override earlier):

1. **Built-in defaults**
2. **Global:** `~/.config/sophos/config.json`
3. **Project:** `./.sophos/config.json`
4. **Legacy:** `./.sophos.json`
5. **Environment variables:** `SOPHOS_*`

### Key Defaults

| Setting | Default |
|---|---|
| `base_url` | `http://localhost:11434` |
| `temperature` | `0.3` |
| `top_p` | `0.95` |
| `num_ctx` | `16384` |
| `timeout_ms` | `300000` (5 min) |
| `max_retries` | `3` |
| `concurrent_requests` | `4` (auto-tuned) |
| `max_review_iterations` | `3` |
| `max_repair_attempts` | `2` |
| `skip_validation` | `false` |
| `skip_security` | `false` |
| `webui.port` | `3777` |

Model tiers (`small`, `medium`, `large`, `coder`, `planner`, `executor`, `chat`) default to auto-detection from available Ollama models.

## Architecture

- **Multi-Agent System** -- Specialized agents per phase with a consensus algorithm (60% supermajority approval threshold, severity-weighted issue deduplication)
- **EventEmitter Orchestrator** -- Emits `phase:start`, `phase:line`, `phase:done`, `phase:fail`, `task:update`, `llm:token`, `steering`, `pipeline:done` for live UI rendering
- **Task Graph** -- Dependency resolution, parallel group scheduling, critical path analysis
- **Repair Loop** -- Failed review triggers code repair; tasks cycle through `active -> repair` states
- **Abort/Cancel** -- `AbortSignal` propagated between phases with graceful shutdown and partial results preserved
- **Tunnel Support** -- cloudflared, localtunnel, or ngrok (auto-detected, 15s startup timeout)

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript (strict, ESNext, ESM) |
| LLM Backend | [Ollama](https://ollama.com) |
| Dependencies | chalk, simple-git |

## Scripts

```bash
bun run dev          # Development mode (interactive TUI)
bun run start        # Production mode
bun run build        # Bundle to dist/
bun run typecheck    # Type-check with tsc --noEmit
bun run test         # Smoke test (shows help)
bun run webui        # Start WebUI server
bun run tunnel       # WebUI + public tunnel
bun run mcp          # Start MCP server
```
