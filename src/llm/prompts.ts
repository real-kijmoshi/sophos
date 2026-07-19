import type { ContextPackage, ImplementationSpecification, TaskPrompt, CodingOutput } from '../types.js';

export const PROMPTS = {

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1 — Repository Analysis
  // ═══════════════════════════════════════════════════════════════════════════

  repositoryAnalysis: (fileTree: string, userRequest: string) => ({
    system: `You are a senior software architect analyzing a codebase. You MUST respond with valid JSON only. No markdown, no explanation outside the JSON.`,
    user: `Analyze this repository and respond with a JSON object matching this exact schema:

{
  "repository_summary": {
    "name": "string",
    "type": "web-app|cli|library|service|monorepo|unknown",
    "language_breakdown": {"language": percentage_number},
    "file_count": number
  },
  "technology_stack": {
    "languages": ["string"],
    "frameworks": ["string"],
    "build_tools": ["string"],
    "package_managers": ["string"],
    "runtime": ["string"]
  },
  "architecture_overview": {
    "pattern": "string",
    "layers": ["string"],
    "entry_points": ["string"]
  },
  "relevant_files": [
    {"path": "string", "reason": "string", "confidence": number_0_to_1}
  ],
  "potential_risks": [
    {"category": "string", "description": "string", "severity": "low|medium|high|critical"}
  ]
}

USER REQUEST: ${userRequest}

REPOSITORY FILE TREE:
${fileTree}

Analyze the file tree, detect patterns, and return the JSON analysis.`
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2 — Planning Swarm (8 specialized planners)
  // ═══════════════════════════════════════════════════════════════════════════

  plannerArchitecture: (ctx: ContextPackage, req: string, relevantFiles: string) => ({
    system: `You are an Architecture Planner in a multi-agent coding system. You design high-level software architecture. Respond with valid JSON only.`,
    user: `Design the architecture for implementing this request in the given codebase.

USER REQUEST: ${req}

CODEBASE ANALYSIS:
${JSON.stringify(ctx.repository_summary, null, 2)}

TECHNOLOGY STACK:
${JSON.stringify(ctx.technology_stack, null, 2)}

CURRENT ARCHITECTURE:
${JSON.stringify(ctx.architecture_overview, null, 2)}

RELEVANT FILES:
${relevantFiles}

Respond with JSON:
{
  "components": [{"name": "string", "responsibilities": ["string"]}],
  "interfaces": [{"name": "string", "methods": ["string"]}],
  "folder_structure": {"add": ["string"], "modify": ["string"], "delete": ["string"]},
  "design_decisions": [{"decision": "string", "rationale": "string"}],
  "risks": ["string"],
  "alternatives_considered": ["string"],
  "tradeoffs": ["string"]
}`
  }),

  plannerBackend: (ctx: ContextPackage, req: string) => ({
    system: `You are a Backend Planner in a multi-agent coding system. You design API endpoints, services, and server logic. Respond with valid JSON only.`,
    user: `Design the backend implementation for this request.

USER REQUEST: ${req}

CODEBASE:
${JSON.stringify(ctx.repository_summary, null, 2)}
Stack: ${ctx.technology_stack.frameworks.join(', ')}

Respond with JSON:
{
  "apis": [{"method": "GET|POST|PUT|DELETE", "path": "string", "request_schema": "string", "response_schema": "string", "auth_required": boolean, "description": "string"}],
  "services": [{"name": "string", "responsibilities": ["string"], "dependencies": ["string"]}],
  "middleware": [{"name": "string", "purpose": "string"}],
  "error_handling": {"strategy": "string", "error_types": ["string"]},
  "design_decisions": [{"decision": "string", "rationale": "string"}],
  "risks": ["string"]
}`
  }),

  plannerFrontend: (ctx: ContextPackage, req: string) => ({
    system: `You are a Frontend Planner in a multi-agent coding system. You design UI components, state management, and user interactions. Respond with valid JSON only.`,
    user: `Design the frontend implementation for this request.

USER REQUEST: ${req}

CODEBASE:
${JSON.stringify(ctx.repository_summary, null, 2)}
Stack: ${ctx.technology_stack.frameworks.join(', ')}

Respond with JSON:
{
  "components": [{"name": "string", "props": [{"name": "string", "type": "string"}], "description": "string"}],
  "state_management": {"approach": "string", "stores": ["string"]},
  "routing": {"changes": ["string"]},
  "styling": {"approach": "string", "files": ["string"]},
  "accessibility": ["string"],
  "design_decisions": [{"decision": "string", "rationale": "string"}],
  "risks": ["string"]
}`
  }),

  plannerDatabase: (ctx: ContextPackage, req: string) => ({
    system: `You are a Database Planner in a multi-agent coding system. You design schemas, migrations, and data access patterns. Respond with valid JSON only.`,
    user: `Design the database implementation for this request.

USER REQUEST: ${req}

CODEBASE:
${JSON.stringify(ctx.repository_summary, null, 2)}

Respond with JSON:
{
  "tables": [{"name": "string", "columns": [{"name": "string", "type": "string", "nullable": boolean, "primary_key": boolean}], "indexes": ["string"]}],
  "migrations": [{"description": "string", "up_sql": "string", "down_sql": "string"}],
  "data_access": [{"table": "string", "operations": ["string"]}],
  "design_decisions": [{"decision": "string", "rationale": "string"}],
  "risks": ["string"]
}`
  }),

  plannerDevOps: (ctx: ContextPackage, req: string) => ({
    system: `You are a DevOps Planner in a multi-agent coding system. You design build pipelines, deployments, and tooling. Respond with valid JSON only.`,
    user: `Design the DevOps changes for this request.

USER REQUEST: ${req}

CODEBASE:
Build tools: ${ctx.technology_stack.build_tools.join(', ')}
Package managers: ${ctx.technology_stack.package_managers.join(', ')}

Respond with JSON:
{
  "dependencies": {"add": [{"name": "string", "version": "string", "reason": "string"}], "remove": [{"name": "string", "reason": "string"}], "update": [{"name": "string", "from": "string", "to": "string", "reason": "string"}]},
  "build_changes": ["string"],
  "ci_cd": ["string"],
  "environment_variables": [{"name": "string", "required": boolean, "description": "string"}],
  "config_files": [{"path": "string", "changes": "string"}],
  "design_decisions": [{"decision": "string", "rationale": "string"}],
  "risks": ["string"]
}`
  }),

  plannerSecurity: (ctx: ContextPackage, req: string) => ({
    system: `You are a Security Planner in a multi-agent coding system. You identify threats and design security controls. Respond with valid JSON only.`,
    user: `Design the security implementation for this request.

USER REQUEST: ${req}

CODEBASE:
${JSON.stringify(ctx.repository_summary, null, 2)}

Respond with JSON:
{
  "threat_model": [{"threat": "string", "likelihood": "low|medium|high", "impact": "low|medium|high", "mitigation": "string"}],
  "security_requirements": [{"category": "string", "requirement": "string", "verification": "string"}],
  "input_validation": [{"field": "string", "rules": ["string"]}],
  "authentication": {"changes": ["string"]},
  "authorization": {"changes": ["string"]},
  "secrets_management": ["string"],
  "design_decisions": [{"decision": "string", "rationale": "string"}],
  "risks": ["string"]
}`
  }),

  plannerPerformance: (ctx: ContextPackage, req: string) => ({
    system: `You are a Performance Planner in a multi-agent coding system. You optimize for speed, memory, and scalability. Respond with valid JSON only.`,
    user: `Design the performance considerations for this request.

USER REQUEST: ${req}

CODEBASE:
${JSON.stringify(ctx.repository_summary, null, 2)}

Respond with JSON:
{
  "performance_goals": [{"metric": "string", "target": "string", "measurement": "string"}],
  "caching_strategy": {"approach": "string", "what_to_cache": ["string"]},
  "optimizations": [{"description": "string", "expected_impact": "string"}],
  "potential_bottlenecks": ["string"],
  "monitoring": ["string"],
  "design_decisions": [{"decision": "string", "rationale": "string"}],
  "risks": ["string"]
}`
  }),

  plannerInfrastructure: (ctx: ContextPackage, req: string) => ({
    system: `You are an Infrastructure Planner in a multi-agent coding system. You design deployment, scaling, and operations. Respond with valid JSON only.`,
    user: `Design the infrastructure changes for this request.

USER REQUEST: ${req}

CODEBASE:
Type: ${ctx.repository_summary.type}
Stack: ${ctx.technology_stack.frameworks.join(', ')}

Respond with JSON:
{
  "deployment": {"strategy": "string", "changes": ["string"]},
  "scaling": {"approach": "string", "considerations": ["string"]},
  "monitoring": {"metrics": ["string"], "alerts": ["string"]},
  "logging": {"approach": "string", "what_to_log": ["string"]},
  "backup_recovery": ["string"],
  "design_decisions": [{"decision": "string", "rationale": "string"}],
  "risks": ["string"]
}`
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2 — Consensus Merging
  // ═══════════════════════════════════════════════════════════════════════════

  consensusMerge: (plannerOutputs: string, userRequest: string) => ({
    system: `You are a Synthesizer Agent merging 8 independent planner proposals into a single coherent implementation specification. You must resolve conflicts and produce a unified plan. Respond with valid JSON only.`,
    user: `Merge these 8 planner proposals into a single implementation specification. Resolve any conflicts by choosing the best approach. Detect file overlaps and resolve them.

USER REQUEST: ${userRequest}

PLANNER PROPOSALS:
${plannerOutputs}

Respond with a complete ImplementationSpecification JSON:
{
  "architecture": {"diagram": "string", "components": [{"name": "string", "responsibilities": ["string"]}], "interfaces": [{"name": "string", "methods": ["string"]}]},
  "folder_structure": {"add": ["string"], "modify": ["string"], "delete": ["string"]},
  "files_to_create": [{"path": "string", "template": "string", "purpose": "string"}],
  "files_to_edit": [{"path": "string", "changes": [{"type": "import|modify|create", "description": "string"}], "reason": "string"}],
  "apis": [{"method": "string", "path": "string", "request": {}, "response": {}, "auth": "string"}],
  "services": [{"name": "string", "responsibilities": ["string"], "dependencies": ["string"]}],
  "components": [{"name": "string", "responsibilities": ["string"]}],
  "database_schema": {"tables": [], "migrations": [], "indexes": []},
  "dependencies": {"add": [{"name": "string", "version": "string", "reason": "string"}], "remove": [], "update": []},
  "configuration": {"env_vars": [{"name": "string", "required": boolean, "description": "string"}], "config_files": []},
  "testing_strategy": {"unit": ["string"], "integration": ["string"], "e2e": ["string"]},
  "security_requirements": [{"category": "string", "requirement": "string", "verification": "string"}],
  "performance_goals": [{"metric": "string", "target": "string", "measurement": "string"}],
  "rollback_strategy": {"steps": ["string"], "triggers": ["string"]},
  "implementation_order": [{"task_id": "TASK-001", "phase": "coding", "dependencies": [], "description": "string"}]
}`
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3 — Execution Planning
  // ═══════════════════════════════════════════════════════════════════════════

  executionPlan: (spec: ImplementationSpecification, context: string) => ({
    system: `You are an Execution Planner. Convert an implementation specification into detailed, self-contained task prompts for coding agents. Each task must be independently executable. Respond with valid JSON only.`,
    user: `Convert this implementation specification into coding agent tasks. Each task must have a complete, self-contained prompt.

IMPLEMENTATION SPECIFICATION:
${JSON.stringify(spec, null, 2)}

CODEBASE CONTEXT:
${context}

Respond with JSON array of tasks:
[{
  "task_id": "TASK-001",
  "objective": "string",
  "context": "string (what the agent needs to know about the codebase)",
  "files": ["string (all files this task touches)"],
  "constraints": ["string"],
  "dependencies": ["string (task_ids this depends on)"],
  "acceptance_criteria": ["string"],
  "test_requirements": ["string"],
  "prompt_for_coding_agent": "string (complete, self-contained instruction the coding agent will execute)"
}]

IMPORTANT: Each prompt_for_coding_agent must be complete enough that an AI coding agent can execute it without seeing other tasks. Include file paths, code style, expected behavior, and edge cases.`
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4 — Code Generation
  // ═══════════════════════════════════════════════════════════════════════════

  codeGeneration: (taskPrompt: TaskPrompt, existingFiles: string) => ({
    system: `You are a senior software engineer writing production code. You must produce clean, correct, well-structured code. Follow existing code conventions exactly. Respond with the code changes only — no markdown fences, no explanation.`,
    user: `${taskPrompt.prompt_for_coding_agent}

EXISTING FILE CONTENTS (read these to understand conventions):
${existingFiles}

For each file you create or modify, output in this EXACT format:
===FILE: path/to/file.ts===
(full file content here)
===END FILE===

For files with edits to existing content, show the COMPLETE updated file.
Every file must be complete and syntactically valid.
Include all imports, types, and implementations.
Write production-quality code — no TODOs, no placeholders.`
  }),

  codeRepair: (taskPrompt: TaskPrompt, errors: string, currentCode: string) => ({
    system: `You are a senior software engineer fixing code issues. Analyze the errors and produce corrected code. Respond with the fixed code only — no markdown fences.`,
    user: `Fix the following issues in the code:

ORIGINAL TASK: ${taskPrompt.objective}

ERRORS TO FIX:
${errors}

CURRENT CODE:
${currentCode}

For each file, output in this EXACT format:
===FILE: path/to/file.ts===
(full corrected file content here)
===END FILE===

Fix ALL issues. Ensure the code is syntactically valid and production-quality.`
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5 — Code Review
  // ═══════════════════════════════════════════════════════════════════════════

  reviewLogic: (taskId: string, diff: string, files: string) => ({
    system: `You are a Logic Reviewer analyzing code changes for correctness. Focus on edge cases, null handling, algorithmic soundness, off-by-one errors, and boundary conditions. Respond with valid JSON only.`,
    user: `Review the following code changes for LOGICAL CORRECTNESS.

Task: ${taskId}

DIFF:
${diff}

FILE CONTENTS:
${files}

Respond with JSON:
{
  "issues": [{"severity": "low|medium|high|critical", "category": "logic", "description": "string", "affected_files": ["string"], "line_numbers": [number], "suggested_fix": "string"}],
  "approval_status": "approved|changes_requested",
  "summary": "string"
}`
  }),

  reviewBug: (taskId: string, diff: string, files: string) => ({
    system: `You are a Bug Reviewer analyzing code changes for defects. Focus on uncaught exceptions, resource leaks, race conditions, memory leaks, and deadlocks. Respond with valid JSON only.`,
    user: `Review the following code changes for BUGS and DEFECTS.

Task: ${taskId}

DIFF:
${diff}

FILE CONTENTS:
${files}

Respond with JSON:
{
  "issues": [{"severity": "low|medium|high|critical", "category": "bug", "description": "string", "affected_files": ["string"], "line_numbers": [number], "suggested_fix": "string"}],
  "approval_status": "approved|changes_requested",
  "summary": "string"
}`
  }),

  reviewArchitecture: (taskId: string, diff: string, files: string) => ({
    system: `You are an Architecture Reviewer analyzing code changes for design alignment. Focus on pattern violations, tech debt, tight coupling, and single responsibility. Respond with valid JSON only.`,
    user: `Review the following code changes for ARCHITECTURAL COMPLIANCE.

Task: ${taskId}

DIFF:
${diff}

FILE CONTENTS:
${files}

Respond with JSON:
{
  "issues": [{"severity": "low|medium|high|critical", "category": "architecture", "description": "string", "affected_files": ["string"], "line_numbers": [number], "suggested_fix": "string"}],
  "approval_status": "approved|changes_requested",
  "summary": "string"
}`
  }),

  reviewStyle: (taskId: string, diff: string, files: string) => ({
    system: `You are a Style Reviewer analyzing code changes for consistency. Focus on naming conventions, formatting, comments, and code complexity. Respond with valid JSON only.`,
    user: `Review the following code changes for STYLE CONSISTENCY.

Task: ${taskId}

DIFF:
${diff}

FILE CONTENTS:
${files}

Respond with JSON:
{
  "issues": [{"severity": "low|medium|high|critical", "category": "style", "description": "string", "affected_files": ["string"], "line_numbers": [number], "suggested_fix": "string"}],
  "approval_status": "approved|changes_requested",
  "summary": "string"
}`
  }),

  reviewPerformance: (taskId: string, diff: string, files: string) => ({
    system: `You are a Performance Reviewer analyzing code changes for efficiency. Focus on N+1 queries, unnecessary computation, blocking I/O, and memory churn. Respond with valid JSON only.`,
    user: `Review the following code changes for PERFORMANCE.

Task: ${taskId}

DIFF:
${diff}

FILE CONTENTS:
${files}

Respond with JSON:
{
  "issues": [{"severity": "low|medium|high|critical", "category": "performance", "description": "string", "affected_files": ["string"], "line_numbers": [number], "suggested_fix": "string"}],
  "approval_status": "approved|changes_requested",
  "summary": "string"
}`
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5 — Review Consensus
  // ═══════════════════════════════════════════════════════════════════════════

  reviewConsensus: (reviews: string) => ({
    system: `You are a Synthesizer Agent merging 5 independent code reviews. You must determine if the code is approved or needs changes, merging all issues and resolving duplicates. Respond with valid JSON only.`,
    user: `Merge these 5 code reviews into a single consensus decision.

REVIEWS:
${reviews}

Respond with JSON:
{
  "approved": boolean,
  "merged_issues": [{"severity": "low|medium|high|critical", "category": "string", "description": "string", "affected_files": ["string"], "line_numbers": [number], "suggested_fix": "string"}],
  "vote_breakdown": {"approved": number, "changes_requested": number},
  "summary": "string"
}`
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 7 — Security Analysis
  // ═══════════════════════════════════════════════════════════════════════════

  securityScan: (agentDomain: string, cweFocus: string[], files: string) => ({
    system: `You are a Security Agent specializing in ${agentDomain}. You scan code for vulnerabilities matching CWE patterns: ${cweFocus.join(', ')}. Respond with valid JSON only.`,
    user: `Scan these code changes for ${agentDomain} vulnerabilities.

CODE:
${files}

Respond with JSON:
{
  "findings": [{"severity": "low|medium|high|critical", "confidence": "low|medium|high", "cwe": "string", "description": "string", "affected_files": ["string"], "line_numbers": [number], "remediation": "string"}],
  "summary": "string"
}`
  }),

  securityConsensus: (allFindings: string) => ({
    system: `You are a Security Synthesizer merging findings from 6 independent security agents. Deduplicate findings, prioritize by severity, and produce a unified report. Respond with valid JSON only.`,
    user: `Merge these security scan results into a unified report.

SECURITY FINDINGS:
${allFindings}

Respond with JSON:
{
  "findings": [{"agent": "string", "severity": "low|medium|high|critical", "confidence": "low|medium|high", "cwe": "string", "description": "string", "affected_files": ["string"], "remediation": "string"}],
  "critical_count": number,
  "high_count": number,
  "summary": "string"
}`
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 9 — Final QA
  // ═══════════════════════════════════════════════════════════════════════════

  finalQA: (userRequest: string, allOutputs: string, securityReport: string, validationResult: string) => ({
    system: `You are a Final QA Agent performing end-to-end validation. You verify that the implementation fully satisfies the user request, is production-ready, and has no remaining issues. Respond with valid JSON only.`,
    user: `Perform final quality assurance on this implementation.

USER REQUEST: ${userRequest}

IMPLEMENTATION OUTPUTS:
${allOutputs}

SECURITY REPORT:
${securityReport}

VALIDATION RESULTS:
${validationResult}

Respond with JSON:
{
  "checks": [{"name": "string", "passed": boolean, "details": "string"}],
  "decision": "approved|rejected",
  "issues": ["string"],
  "executive_summary": "string",
  "known_limitations": ["string"],
  "remaining_recommendations": ["string"]
}`
  }),
};
