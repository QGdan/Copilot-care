const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const REQUIRED_RULE_FILES = [
  '.opencode/rules/architecture.md',
  '.opencode/rules/testing.md',
  '.opencode/rules/adr.md',
  '.opencode/rules/superpower.md',
  '.opencode/rules/agent-roles.md',
  '.opencode/rules/workflow-gates.md',
];

const REQUIRED_INSTRUCTIONS = [
  'CONTRIBUTING.md',
  'docs/architecture.md',
  'docs/process/ch3-6-architecture-blueprint.md',
  'docs/process/opencode-operation-guide.md',
  'docs/process/todos-workflow.md',
  'README.md',
  'docs/process/development-workflow.md',
  'docs/process/opencode-command-mapping.md',
  '.opencode/rules/*.md',
];

const REQUIRED_COMMANDS_IN_GUIDE = [
  'npm run typecheck',
  'npm run security:baseline',
  'npm run gate:release',
  'npm run gate:safety',
  'npm run gate:workflow',
  'npm run gate:scenarios',
  'npm run guard:imports',
  'npm run gate:metrics',
  'npm run devwf:arch',
  'npm run devwf:full',
  'npm run todos:doctor',
  'npm run todos:milestone -- <M6|M7|M8|M9|M10|M11|M12|M13|M14|M15> --run',
];

const REQUIRED_TODO_MILESTONES = [
  'M6',
  'M7',
  'M8',
  'M9',
  'M10',
  'M11',
  'M12',
  'M13',
  'M14',
  'M15',
];

const REQUIRED_ARCHITECTURE_FILES = [
  'src/backend/src/bootstrap/createBackendApp.ts',
  'src/backend/src/bootstrap/createRuntime.ts',
  'src/backend/src/interfaces/http/createTriageRouter.ts',
  'src/backend/src/application/usecases/RunTriageSessionUseCase.ts',
  'src/backend/src/infrastructure/orchestration/DebateEngineOrchestrator.ts',
  'src/frontend/src/views/ConsultationView.vue',
  'src/frontend/src/services/triageApi.ts',
  'src/shared/types.ts',
];

const REQUIRED_WORKSPACE_TEST_SCRIPTS = [
  {
    packageFile: 'src/backend/package.json',
    workspace: '@copilot-care/backend',
  },
  {
    packageFile: 'src/frontend/package.json',
    workspace: '@copilot-care/frontend',
  },
  {
    packageFile: 'src/shared/package.json',
    workspace: '@copilot-care/shared',
  },
];

const REQUIRED_EXPERT_ROLES = [
  'cardiology',
  'generalPractice',
  'metabolic',
  'safety',
];

const REQUIRED_EXPERT_AGENTS = [
  'CardiologyAgent',
  'GPAgent',
  'MetabolicAgent',
  'SafetyAgent',
];

const REQUIRED_EXPERT_PROVIDER_ENV_KEYS = [
  'COPILOT_CARE_CARDIO_PROVIDER',
  'COPILOT_CARE_GP_PROVIDER',
  'COPILOT_CARE_METABOLIC_PROVIDER',
  'COPILOT_CARE_SAFETY_PROVIDER',
];

const SUPERPOWER_PLUGIN_PATH = '.opencode/plugins/superpower/index.js';

function fail(message) {
  console.error(`[gate] FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`[gate] PASS: ${message}`);
}

function readText(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function exists(filePath) {
  return fs.existsSync(path.join(ROOT, filePath));
}

function loadOpenCodeConfig() {
  if (!exists('opencode.json')) {
    fail('missing opencode.json');
    return null;
  }

  try {
    return JSON.parse(readText('opencode.json'));
  } catch (error) {
    fail(`invalid opencode.json: ${error.message}`);
    return null;
  }
}

function validateInstructions(config) {
  const instructions = Array.isArray(config.instructions)
    ? config.instructions
    : [];

  for (const required of REQUIRED_INSTRUCTIONS) {
    if (!instructions.includes(required)) {
      fail(`opencode instructions missing: ${required}`);
    }
  }

  for (const item of instructions) {
    if (item === '.opencode/rules/*.md') {
      const rulesDir = path.join(ROOT, '.opencode', 'rules');
      if (!fs.existsSync(rulesDir)) {
        fail('rules directory missing for wildcard instruction');
        continue;
      }
      const mdCount = fs
        .readdirSync(rulesDir)
        .filter((file) => file.endsWith('.md')).length;
      if (mdCount === 0) {
        fail('rules wildcard is configured but no markdown rules found');
      }
      continue;
    }

    if (!exists(item)) {
      fail(`instruction file not found: ${item}`);
    }
  }

  pass('instruction targets resolved');
}

function validateOpenCodeConfig(config) {
  if (!config) {
    return;
  }

  if (config.default_agent !== 'build') {
    fail('default_agent must be build');
  } else {
    pass('default_agent is build');
  }

  const agents = config.agent || {};
  for (const name of ['plan', 'build', 'reviewer']) {
    if (!agents[name]) {
      fail(`missing required agent config: ${name}`);
    }
  }

  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  if (plugins.includes(SUPERPOWER_PLUGIN_PATH)) {
    fail(
      `remove local plugin from opencode.json.plugin: ${SUPERPOWER_PLUGIN_PATH}`,
    );
  } else {
    pass('local plugin is not declared in opencode.json.plugin');
  }

  if (!exists(SUPERPOWER_PLUGIN_PATH)) {
    fail('superpower plugin file does not exist');
  } else {
    pass('superpower plugin source file exists');
  }

  validateInstructions(config);
}

function validateRuleFiles() {
  for (const file of REQUIRED_RULE_FILES) {
    if (!exists(file)) {
      fail(`missing rule file: ${file}`);
    }
  }

  const superpower = '.opencode/rules/superpower.md';
  if (exists(superpower)) {
    const content = readText(superpower);
    for (const marker of ['Hard Limits', 'Mandatory Checks', 'Dissent Index']) {
      if (!content.includes(marker)) {
        fail(`superpower rule missing marker: ${marker}`);
      }
    }
  }

  pass('rule files checked');
}

function validateWorkflowDocs() {
  const files = [
    'README.md',
    'docs/architecture.md',
    'docs/process/ch3-6-architecture-blueprint.md',
    'docs/process/opencode-operation-guide.md',
    'docs/process/todos-workflow.md',
    'docs/process/todos-workflow.v5_00.json',
    'docs/process/development-workflow.md',
    'docs/process/opencode-command-mapping.md',
    'docs/process/dependency-vulnerability-workflow.md',
    'docs/process/reviewer-findings-template.md',
    'docs/process/governance-release-package.md',
    'docs/process/risk-trigger-matrix.md',
    'docs/process/stop-loss-rollback-runbook.md',
    'docs/process/pilot-runbook-role-matrix.md',
    'docs/process/fhir-smart-mapping.md',
    'docs/process/fhir-smart-validation-record.md',
    'docs/process/scenario-replication-pipeline.md',
    'docs/process/m5-closeout-report.md',
    'docs/process/next-iteration-backlog.md',
    'docs/process/iteration-01-task-status.md',
    'docs/process/iteration-01-milestone-record.md',
    'docs/process/iteration-01-closeout.md',
    'docs/adr/0001-opencode-superpower-governance.md',
    'docs/adr/0003-interactive-llm-timeout-and-review-stage.md',
    'CONTRIBUTING.md',
  ];

  for (const file of files) {
    if (!exists(file)) {
      fail(`missing documentation file: ${file}`);
    }
  }

  if (exists('docs/process/opencode-operation-guide.md')) {
    const guide = readText('docs/process/opencode-operation-guide.md');
    for (const command of REQUIRED_COMMANDS_IN_GUIDE) {
      if (!guide.includes(command)) {
        fail(`operation guide missing command: ${command}`);
      }
    }
  }

  if (exists('.opencode/rules/workflow-gates.md')) {
    const gates = readText('.opencode/rules/workflow-gates.md');
    if (!gates.includes('Architecture Workflow Gate')) {
      fail('workflow gates must define Architecture Workflow Gate');
    }
  }

  for (const file of REQUIRED_ARCHITECTURE_FILES) {
    if (!exists(file)) {
      fail(`missing architecture baseline file: ${file}`);
    }
  }

  validateReviewerTemplate();

  for (const check of REQUIRED_WORKSPACE_TEST_SCRIPTS) {
    if (!exists(check.packageFile)) {
      fail(`missing workspace package file: ${check.packageFile}`);
      continue;
    }
    const pkg = readJson(check.packageFile);
    const testScript = pkg.scripts && pkg.scripts.test;
    if (!testScript || typeof testScript !== 'string') {
      fail(`workspace test script missing: ${check.workspace}`);
      continue;
    }

    if (/no .*tests configured yet/i.test(testScript)) {
      fail(`workspace test script is placeholder: ${check.workspace}`);
    }
  }

  validateTodoWorkflowManifest();
  validateTodoWorkflowScripts();

  pass('workflow documentation checked');
}

function validateReviewerTemplate() {
  const file = 'docs/process/reviewer-findings-template.md';
  if (!exists(file)) {
    fail(`missing reviewer template: ${file}`);
    return;
  }

  const content = readText(file);
  const requiredMarkers = [
    'Decision: `PASS` or `BLOCK`',
    'failedGateIds:',
    '`typecheck`:',
    '`guard:imports`:',
    '`gate:safety`:',
    '`gate:workflow`:',
    '`gate:scenarios`:',
    '`gate:metrics`:',
    '`security:baseline`:',
    '`gate:release`:',
    '`devwf:arch`:',
    '`devwf:full`:',
    '## 6) Evidence Links',
    'Missing evidence IDs (if any):',
  ];

  for (const marker of requiredMarkers) {
    if (!content.includes(marker)) {
      fail(`reviewer template missing marker: ${marker}`);
    }
  }
}

function validateTodoWorkflowManifest() {
  const manifestPath = 'docs/process/todos-workflow.v5_00.json';
  if (!exists(manifestPath)) {
    fail(`missing todo workflow manifest: ${manifestPath}`);
    return;
  }

  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    fail(`invalid todo workflow manifest json: ${error.message}`);
    return;
  }

  const match = /^v5\.(\d+)$/.exec(String(manifest.version || ''));
  const patchVersion = match ? Number(match[1]) : Number.NaN;
  if (!match || Number.isNaN(patchVersion) || patchVersion < 11) {
    fail(
      `todo workflow manifest version must be v5.11+ compatible, got: ${manifest.version}`,
    );
  }

  if (
    !manifest.source ||
    manifest.source.planDocument !== 'docs/process/next-iteration-backlog.md'
  ) {
    fail('todo workflow manifest must reference docs/process/next-iteration-backlog.md');
  }

  if (
    !manifest.source ||
    typeof manifest.source.extractedText !== 'string' ||
    !manifest.source.extractedText.trim()
  ) {
    fail('todo workflow manifest must define source.extractedText');
  } else {
    const extractedText = manifest.source.extractedText.trim();
    if (!exists(extractedText)) {
      fail(`todo workflow extracted text not found: ${extractedText}`);
    }
    if (extractedText.startsWith('.tmp')) {
      fail('todo workflow extracted text path must not use temporary file naming');
    }
  }

  if (!Array.isArray(manifest.milestones) || manifest.milestones.length === 0) {
    fail('todo workflow manifest milestones must be non-empty');
    return;
  }

  if (!Array.isArray(manifest.todos) || manifest.todos.length < 18) {
    fail('todo workflow manifest must include at least 18 todos');
    return;
  }

  const milestoneIds = new Set(manifest.milestones.map((item) => item.id));
  for (const requiredId of REQUIRED_TODO_MILESTONES) {
    if (!milestoneIds.has(requiredId)) {
      fail(`todo workflow missing milestone: ${requiredId}`);
    }
  }

  const todoIds = new Set();
  for (const todo of manifest.todos) {
    if (!todo.id || typeof todo.id !== 'string') {
      fail('todo workflow item missing id');
      continue;
    }
    if (todoIds.has(todo.id)) {
      fail(`todo workflow duplicated id: ${todo.id}`);
      continue;
    }
    todoIds.add(todo.id);

    if (!milestoneIds.has(todo.milestone)) {
      fail(`todo workflow item has unknown milestone: ${todo.id} -> ${todo.milestone}`);
    }

    if (!Array.isArray(todo.dependsOn)) {
      fail(`todo workflow item dependsOn must be array: ${todo.id}`);
    }

    if (
      !todo.commands ||
      !Array.isArray(todo.commands.verify) ||
      todo.commands.verify.length === 0
    ) {
      fail(`todo workflow item must define verify command(s): ${todo.id}`);
    }
  }

  for (const milestone of manifest.milestones) {
    if (!Array.isArray(milestone.requiredTodoIds)) {
      fail(`todo workflow milestone requiredTodoIds must be array: ${milestone.id}`);
      continue;
    }
    for (const todoId of milestone.requiredTodoIds) {
      if (!todoIds.has(todoId)) {
        fail(`todo workflow milestone references missing todo: ${milestone.id} -> ${todoId}`);
      }
    }
  }

  pass('todo workflow manifest checked');
}

function validateTodoWorkflowScripts() {
  if (!exists('scripts/todos-workflow.cjs')) {
    fail('missing todo workflow script: scripts/todos-workflow.cjs');
    return;
  }

  if (!exists('package.json')) {
    fail('missing package.json for todo workflow script check');
    return;
  }

  const pkg = readJson('package.json');
  const scripts = pkg.scripts || {};
  const requiredScripts = [
    'todos:doctor',
    'todos:init',
    'todos:status',
    'todos:list',
    'todos:next',
    'todos:start',
    'todos:review',
    'todos:block',
    'todos:done',
    'todos:verify',
    'todos:milestone',
    'batch:m5',
    'scenarios:replicate',
  ];

  for (const scriptName of requiredScripts) {
    if (!scripts[scriptName]) {
      fail(`missing npm script: ${scriptName}`);
    }
  }

  pass('todo workflow scripts checked');
}

function validateExpertRuntimeWiring() {
  const runtimeFile = 'src/backend/src/bootstrap/createRuntime.ts';
  const llmFactoryFile = 'src/backend/src/llm/createClinicalLLMClient.ts';
  const orchestratorFile =
    'src/backend/src/infrastructure/orchestration/ComplexityRoutedOrchestrator.ts';

  if (!exists(runtimeFile)) {
    fail(`missing runtime wiring file: ${runtimeFile}`);
    return;
  }

  if (!exists(llmFactoryFile)) {
    fail(`missing llm factory file: ${llmFactoryFile}`);
    return;
  }

  if (!exists(orchestratorFile)) {
    fail(`missing orchestrator file: ${orchestratorFile}`);
    return;
  }

  const runtimeSource = readText(runtimeFile);
  const llmFactorySource = readText(llmFactoryFile);
  const orchestratorSource = readText(orchestratorFile);

  for (const agentName of REQUIRED_EXPERT_AGENTS) {
    if (!runtimeSource.includes(`new ${agentName}(`)) {
      fail(`runtime must wire expert agent: ${agentName}`);
    }
  }

  for (const role of REQUIRED_EXPERT_ROLES) {
    if (!runtimeSource.includes(`${role}: {`)) {
      fail(`runtime architecture snapshot missing role: ${role}`);
    }
  }

  for (const envKey of REQUIRED_EXPERT_PROVIDER_ENV_KEYS) {
    if (!llmFactorySource.includes(envKey)) {
      fail(`llm expert provider env key missing: ${envKey}`);
    }
  }

  if (!orchestratorSource.includes("createWorkflowStage('REVIEW'")) {
    fail('orchestrator state-machine trace must include REVIEW stage');
  }

  pass('expert runtime wiring checked');
}

function validateWorkspaceHygiene() {
  const rootTempFiles = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith('.tmp'))
    .map((entry) => entry.name);

  if (rootTempFiles.length > 0) {
    fail(
      `workspace hygiene violation: remove root temporary files (${rootTempFiles.join(', ')})`,
    );
    return;
  }

  pass('workspace hygiene checked');
}

function runWorkspaceTests() {
  const result = spawnSync('npm test --workspaces', {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });

  if (result.error) {
    fail(`workspace tests failed: ${result.error.message}`);
    return;
  }

  if (result.status !== 0) {
    fail(`workspace tests failed with exit code ${result.status}`);
    return;
  }

  pass('workspace tests passed');
}

function main() {
  const mode = process.argv[2] || 'safety';
  const runTests = process.argv.includes('--run-tests');

  const config = loadOpenCodeConfig();

  if (mode === 'safety') {
    validateOpenCodeConfig(config);
    validateRuleFiles();
  } else if (mode === 'workflow') {
    validateOpenCodeConfig(config);
    validateWorkflowDocs();
    validateExpertRuntimeWiring();
    validateWorkspaceHygiene();
  } else if (mode === 'scenarios') {
    validateOpenCodeConfig(config);
    validateRuleFiles();
    validateWorkflowDocs();
    validateExpertRuntimeWiring();
    validateWorkspaceHygiene();
    if (runTests) {
      runWorkspaceTests();
    }
  } else {
    console.error(`Unknown mode: ${mode}`);
    process.exitCode = 2;
  }

  if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode);
  }
}

main();
