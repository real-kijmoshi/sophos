// ── Core Types ───────────────────────────────────────────────────────────────

export type PhaseId =
  | 'repository-analysis'
  | 'planning-swarm'
  | 'execution-planning'
  | 'coding-swarm'
  | 'multi-agent-review'
  | 'automated-validation'
  | 'security-swarm'
  | 'integration'
  | 'final-qa';

export type PhaseStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'aborted';

export interface PhaseResult {
  phase: PhaseId;
  status: PhaseStatus;
  output: unknown;
  duration_ms: number;
  errors: string[];
}

// ── Repository Analysis ──────────────────────────────────────────────────────

export interface RepositorySummary {
  name: string;
  type: 'web-app' | 'cli' | 'library' | 'service' | 'monorepo' | 'unknown';
  size_mb: number;
  file_count: number;
  language_breakdown: Record<string, number>;
}

export interface TechnologyStack {
  languages: string[];
  frameworks: string[];
  build_tools: string[];
  package_managers: string[];
  runtime: string[];
}

export interface ArchitectureOverview {
  pattern: string;
  layers: string[];
  entry_points: string[];
}

export interface DependencyNode {
  id: string;
  type: string;
  path: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: string;
}

export interface RelevantFile {
  path: string;
  reason: string;
  confidence: number;
}

export interface PotentialRisk {
  category: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ContextPackage {
  repository_summary: RepositorySummary;
  technology_stack: TechnologyStack;
  architecture_overview: ArchitectureOverview;
  dependency_graph: {
    nodes: DependencyNode[];
    edges: DependencyEdge[];
  };
  relevant_files: RelevantFile[];
  potential_risks: PotentialRisk[];
  context_package_version: string;
}

// ── Planning Swarm ───────────────────────────────────────────────────────────

export interface ArchitectureComponent {
  name: string;
  responsibilities: string[];
}

export interface ArchitectureInterface {
  name: string;
  methods: string[];
}

export interface FileChange {
  type: 'import' | 'modify' | 'create' | 'delete';
  lines?: [number, number];
  description?: string;
  add?: string[];
}

export interface FileToCreate {
  path: string;
  template: string;
  purpose: string;
}

export interface FileToEdit {
  path: string;
  changes: FileChange[];
  reason: string;
}

export interface ApiService {
  method: string;
  path: string;
  request: Record<string, string>;
  response: Record<string, string>;
  auth: string;
}

export interface ServiceDefinition {
  name: string;
  responsibilities: string[];
  dependencies: string[];
}

export interface DatabaseTable {
  name: string;
  columns: { name: string; type: string; nullable?: boolean }[];
  indexes?: string[];
}

export interface Migration {
  up: string;
  down: string;
}

export interface DependencyChange {
  name: string;
  version?: string;
  reason: string;
}

export interface EnvVar {
  name: string;
  required: boolean;
  description: string;
}

export interface ConfigFile {
  path: string;
  changes: string;
}

export interface TestingStrategy {
  unit: string[];
  integration: string[];
  e2e: string[];
}

export interface SecurityRequirement {
  category: string;
  requirement: string;
  verification: string;
}

export interface PerformanceGoal {
  metric: string;
  target: string;
  measurement: string;
}

export interface RollbackStrategy {
  steps: string[];
  triggers: string[];
}

export interface TaskDefinition {
  task_id: string;
  phase: string;
  dependencies: string[];
  description: string;
  effort: 'small' | 'medium' | 'large';
}

export interface ImplementationSpecification {
  architecture: {
    diagram: string;
    components: ArchitectureComponent[];
    interfaces: ArchitectureInterface[];
  };
  folder_structure: {
    add: string[];
    modify: string[];
    delete: string[];
  };
  files_to_create: FileToCreate[];
  files_to_edit: FileToEdit[];
  apis: ApiService[];
  services: ServiceDefinition[];
  components: ArchitectureComponent[];
  database_schema: {
    tables: DatabaseTable[];
    migrations: Migration[];
    indexes: string[];
  };
  dependencies: {
    add: DependencyChange[];
    remove: DependencyChange[];
    update: DependencyChange[];
  };
  configuration: {
    env_vars: EnvVar[];
    config_files: ConfigFile[];
  };
  testing_strategy: TestingStrategy;
  security_requirements: SecurityRequirement[];
  performance_goals: PerformanceGoal[];
  rollback_strategy: RollbackStrategy;
  implementation_order: TaskDefinition[];
}

// ── Execution Planning ───────────────────────────────────────────────────────

export interface TaskPrompt {
  task_id: string;
  objective: string;
  context: string;
  files: string[];
  constraints: string[];
  dependencies: string[];
  acceptance_criteria: string[];
  test_requirements: string[];
  prompt_for_coding_agent: string;
  effort?: 'small' | 'medium' | 'large';
}

export interface TaskGraph {
  tasks: TaskPrompt[];
  parallel_groups: string[][];
  critical_path: string[];
}

// ── Coding Agent Output ──────────────────────────────────────────────────────

export interface CodingOutput {
  task_id: string;
  unified_diff: string;
  files_changed: string[];
  summary: string;
  assumptions: string[];
  suggested_follow_up: string[];
}

// ── Code Review ──────────────────────────────────────────────────────────────

export type ReviewSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ReviewIssue {
  severity: ReviewSeverity;
  category: string;
  description: string;
  affected_files: string[];
  line_numbers: number[];
  suggested_fix: string;
}

export type ApprovalStatus = 'approved' | 'changes_requested';

export interface ReviewResult {
  reviewer: string;
  task_id: string;
  issues: ReviewIssue[];
  approval_status: ApprovalStatus;
}

// ── Security Scan ────────────────────────────────────────────────────────────

export interface SecurityFinding {
  agent: string;
  domain: string;
  severity: ReviewSeverity;
  confidence: 'low' | 'medium' | 'high';
  cwe: string;
  description: string;
  affected_files: string[];
  line_numbers: number[];
  remediation: string;
}

// ── Integration ──────────────────────────────────────────────────────────────

export interface IntegrationResult {
  integration_status: 'success' | 'failure';
  merged_patches: string[];
  conflicts_resolved: number;
  conflicts_manual: number;
  integrity_check: 'passed' | 'failed';
  errors: string[];
}

// ── Final QA ─────────────────────────────────────────────────────────────────

export interface QACheck {
  name: string;
  passed: boolean;
  details: string;
}

export interface QAResult {
  checks: QACheck[];
  decision: 'approved' | 'rejected';
  issues: string[];
}

// ── Deliverables ─────────────────────────────────────────────────────────────

export interface Deliverables {
  executive_summary: string;
  implementation_summary: string[];
  files_modified: { path: string; diff: string }[];
  files_created: { path: string; content: string }[];
  database_changes: { schema: string; migrations: string[] };
  api_changes: { added: ApiService[]; modified: ApiService[]; deprecated: ApiService[] };
  test_results: { passed: number; failed: number; coverage: number };
  validation_results: { build: boolean; lint: boolean; typecheck: boolean };
  security_report: SecurityFinding[];
  performance_notes: string[];
  known_limitations: string[];
  remaining_recommendations: string[];
}

// ── Agent ────────────────────────────────────────────────────────────────────

export type AgentRole =
  | 'repository-analyzer'
  | 'planner'
  | 'execution-planner'
  | 'coding-agent'
  | 'reviewer'
  | 'security-agent'
  | 'integration-manager'
  | 'final-qa'
  | 'synthesizer';

export interface AgentConfig {
  role: AgentRole;
  name: string;
  description: string;
  model_tier: 'small' | 'medium' | 'large';
}

// ── Orchestrator Config ──────────────────────────────────────────────────────

export interface OrchestratorConfig {
  target_dir: string;
  user_request: string;
  max_review_iterations: number;
  max_repair_attempts: number;
  verbose: boolean;
  dry_run: boolean;
  /** Runtime model overrides — set by REPL's ModelSelector */
  model_small?:    string;
  model_medium?:   string;
  model_large?:    string;
  model_coder?:    string;
  model_planner?:  string;
  model_executor?: string;
  model_chat?:     string;
}
