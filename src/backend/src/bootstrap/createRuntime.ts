import { CardiologyAgent } from '../agents/CardiologyAgent';
import { GPAgent } from '../agents/GPAgent';
import { MetabolicAgent } from '../agents/MetabolicAgent';
import { SafetyAgent } from '../agents/SafetyAgent';
import {
  SafetyOutputGuardConfig,
  SafetyOutputGuardService,
} from '../application/services/SafetyOutputGuardService';
import { RunTriageSessionUseCase } from '../application/usecases/RunTriageSessionUseCase';
import { AuthoritativeMedicalSearchPort } from '../application/ports/AuthoritativeMedicalSearchPort';
import { DebateEngine } from '../core/DebateEngine';
import { ComplexityRoutedOrchestrator } from '../infrastructure/orchestration/ComplexityRoutedOrchestrator';
import { CoordinatorSnapshotService } from '../infrastructure/orchestration/CoordinatorSnapshotService';
import { GovernanceRuntimeTelemetry } from '../infrastructure/governance/GovernanceRuntimeTelemetry';
import { createGovernanceRuntimeStateStore } from '../infrastructure/governance/GovernanceRuntimeStateStore';
import { createAuthoritativeMedicalSearchService } from '../infrastructure/knowledge/AuthoritativeMedicalWebSearchService';
import { createPatientContextEnricher } from '../infrastructure/mcp/PatientContextEnricher';
import { createTriageIdempotencyStore } from '../infrastructure/persistence/TriageIdempotencyStore';
import { parseBooleanFlag } from '../config/runtimePolicy';
import {
  createClinicalExpertLLMClients,
  createClinicalLLMClientForProvider,
  resolveClinicalExpertProviderAssignments,
} from '../llm/createClinicalLLMClient';
import {
  ClinicalLLMClient,
  ClinicalLLMProvider,
  ClinicalExpertKey,
  ProviderAssignmentSource,
} from '../llm/types';

export interface ExpertRuntimeState {
  provider: string;
  source: ProviderAssignmentSource;
  llmEnabled: boolean;
  envKey: string;
}

export type ExpertRuntimeStates = Record<ClinicalExpertKey, ExpertRuntimeState>;

export interface PanelProviderRuntimeState {
  provider: ClinicalLLMProvider;
  llmEnabled: boolean;
}

export interface RuntimeArchitectureSnapshot {
  experts: ExpertRuntimeStates;
  routing: {
    policyVersion: string;
    complexityThresholds: {
      fastConsensusMax: number;
      lightDebateMax: number;
      deepDebateMin: number;
    };
    panelProviders: {
      cardiology: PanelProviderRuntimeState[];
      generalPractice: PanelProviderRuntimeState[];
      metabolic: PanelProviderRuntimeState[];
    };
  };
}

export interface BackendRuntime {
  triageUseCase: RunTriageSessionUseCase;
  architecture: RuntimeArchitectureSnapshot;
  coordinatorSnapshotService: CoordinatorSnapshotService;
  governanceRuntimeTelemetry: GovernanceRuntimeTelemetry;
  authoritativeMedicalSearch: AuthoritativeMedicalSearchPort;
}

const PANEL_PROVIDER_DEFAULTS: Record<
  'cardiology' | 'generalPractice' | 'metabolic',
  ClinicalLLMProvider[]
> = {
  cardiology: ['deepseek', 'gemini'],
  generalPractice: ['gemini', 'deepseek'],
  metabolic: ['gemini', 'deepseek'],
};

const PANEL_PROVIDER_ENV_KEYS: Record<
  'cardiology' | 'generalPractice' | 'metabolic',
  string
> = {
  cardiology: 'COPILOT_CARE_CARDIO_PANEL_PROVIDERS',
  generalPractice: 'COPILOT_CARE_GP_PANEL_PROVIDERS',
  metabolic: 'COPILOT_CARE_METABOLIC_PANEL_PROVIDERS',
};

const PANEL_PROVIDER_CANDIDATES: ReadonlySet<ClinicalLLMProvider> = new Set([
  'deepseek',
  'gemini',
  'kimi',
  'openai',
  'anthropic',
]);

function parsePanelProviders(value: string | undefined): ClinicalLLMProvider[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[,\|>\s]+/)
    .map((item) => item.trim().toLowerCase() as ClinicalLLMProvider)
    .filter((item) => PANEL_PROVIDER_CANDIDATES.has(item));
}

function dedupeProviders(providers: ClinicalLLMProvider[]): ClinicalLLMProvider[] {
  return [...new Set(providers)];
}

function resolvePanelProviders(
  env: NodeJS.ProcessEnv,
): Record<'cardiology' | 'generalPractice' | 'metabolic', ClinicalLLMProvider[]> {
  return {
    cardiology: dedupeProviders(
      parsePanelProviders(env[PANEL_PROVIDER_ENV_KEYS.cardiology]).length > 0
        ? parsePanelProviders(env[PANEL_PROVIDER_ENV_KEYS.cardiology])
        : PANEL_PROVIDER_DEFAULTS.cardiology,
    ),
    generalPractice: dedupeProviders(
      parsePanelProviders(env[PANEL_PROVIDER_ENV_KEYS.generalPractice]).length > 0
        ? parsePanelProviders(env[PANEL_PROVIDER_ENV_KEYS.generalPractice])
        : PANEL_PROVIDER_DEFAULTS.generalPractice,
    ),
    metabolic: dedupeProviders(
      parsePanelProviders(env[PANEL_PROVIDER_ENV_KEYS.metabolic]).length > 0
        ? parsePanelProviders(env[PANEL_PROVIDER_ENV_KEYS.metabolic])
        : PANEL_PROVIDER_DEFAULTS.metabolic,
    ),
  };
}

function parseSafetyGuardTerms(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const terms = value
    .split(/[;,\|\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return terms.length > 0 ? terms : undefined;
}

function resolveSafetyOutputGuardConfig(
  env: NodeJS.ProcessEnv,
): Partial<SafetyOutputGuardConfig> {
  return {
    selfHarmOrViolenceTerms: parseSafetyGuardTerms(
      env.COPILOT_CARE_SAFETY_SELF_HARM_TERMS,
    ),
    promptInjectionTerms: parseSafetyGuardTerms(
      env.COPILOT_CARE_SAFETY_PROMPT_INJECTION_TERMS,
    ),
    unsafeDirectiveTerms: parseSafetyGuardTerms(
      env.COPILOT_CARE_SAFETY_UNSAFE_DIRECTIVE_TERMS,
    ),
  };
}

class PanelCardiologyAgent extends CardiologyAgent {
  constructor(id: string, name: string, llmClient: ClinicalLLMClient | null) {
    super(llmClient);
    this.id = id;
    this.name = name;
  }
}

class PanelGPAgent extends GPAgent {
  constructor(id: string, name: string, llmClient: ClinicalLLMClient | null) {
    super(llmClient);
    this.id = id;
    this.name = name;
  }
}

class PanelMetabolicAgent extends MetabolicAgent {
  constructor(id: string, name: string, llmClient: ClinicalLLMClient | null) {
    super(llmClient);
    this.id = id;
    this.name = name;
  }
}

function buildPanelProviderStates(
  providers: ClinicalLLMProvider[],
  env: NodeJS.ProcessEnv,
): { states: PanelProviderRuntimeState[]; clients: ClinicalLLMClient[] } {
  const states: PanelProviderRuntimeState[] = [];
  const clients: ClinicalLLMClient[] = [];

  for (const provider of providers) {
    const client = createClinicalLLMClientForProvider(provider, env);
    const enabled = Boolean(client);
    states.push({
      provider,
      llmEnabled: enabled,
    });
    if (client) {
      clients.push(client);
    }
  }

  return { states, clients };
}

function createCardiologyPanelAgents(
  clients: ClinicalLLMClient[],
): CardiologyAgent[] {
  const panelAgents =
    clients.length > 0
      ? clients.map(
          (client, index) =>
            new PanelCardiologyAgent(
              `cardio_panel_${index + 1}`,
              `心血管协同模型-${index + 1}`,
              client,
            ),
        )
      : [new PanelCardiologyAgent('cardio_panel_local', '心血管协同-本地兜底', null)];

  return panelAgents;
}

function createGPPanelAgents(
  clients: ClinicalLLMClient[],
): GPAgent[] {
  const panelAgents =
    clients.length > 0
      ? clients.map(
          (client, index) =>
            new PanelGPAgent(
              `gp_panel_${index + 1}`,
              `全科协同模型-${index + 1}`,
              client,
            ),
        )
      : [new PanelGPAgent('gp_panel_local', '全科协同-本地兜底', null)];

  return panelAgents;
}

function createMetabolicPanelAgents(
  clients: ClinicalLLMClient[],
): MetabolicAgent[] {
  const panelAgents =
    clients.length > 0
      ? clients.map(
          (client, index) =>
            new PanelMetabolicAgent(
              `metabolic_panel_${index + 1}`,
              `代谢协同模型-${index + 1}`,
              client,
            ),
        )
      : [new PanelMetabolicAgent('metabolic_panel_local', '代谢协同-本地兜底', null)];

  return panelAgents;
}

export function createRuntime(
  env: NodeJS.ProcessEnv = process.env,
): BackendRuntime {
  const llmClients = createClinicalExpertLLMClients(env);
  const assignments = resolveClinicalExpertProviderAssignments(env);
  const patientContextEnricher = createPatientContextEnricher(env);
  const authoritativeMedicalSearch = createAuthoritativeMedicalSearchService(env);
  const idempotencyStore = createTriageIdempotencyStore(env);
  const governanceRuntimeStateStore = createGovernanceRuntimeStateStore(env);
  const injectAuthoritativeEvidence = parseBooleanFlag(
    env.COPILOT_CARE_MED_SEARCH_IN_TRIAGE,
    authoritativeMedicalSearch.isEnabled(),
  );
  const coordinatorSnapshotService = new CoordinatorSnapshotService(env);
  const governanceRuntimeTelemetry = new GovernanceRuntimeTelemetry(
    80,
    governanceRuntimeStateStore,
  );
  const panelProviders = resolvePanelProviders(env);
  const cardioPanel = buildPanelProviderStates(panelProviders.cardiology, env);
  const gpPanel = buildPanelProviderStates(panelProviders.generalPractice, env);
  const metabolicPanel = buildPanelProviderStates(panelProviders.metabolic, env);
  const safetyOutputGuardService = new SafetyOutputGuardService(
    resolveSafetyOutputGuardConfig(env),
  );

  const deepDebateEngine = new DebateEngine([
    new CardiologyAgent(llmClients.cardiology),
    new GPAgent(llmClients.generalPractice),
    new MetabolicAgent(llmClients.metabolic),
    new SafetyAgent(llmClients.safety),
  ], {
    maxRounds: 3,
  });

  const fastDepartmentEngines = {
    cardiology: new DebateEngine(
      createCardiologyPanelAgents(cardioPanel.clients),
      { maxRounds: 1 },
    ),
    generalPractice: new DebateEngine(
      createGPPanelAgents(gpPanel.clients),
      { maxRounds: 1 },
    ),
    metabolic: new DebateEngine(
      createMetabolicPanelAgents(metabolicPanel.clients),
      { maxRounds: 1 },
    ),
  };

  const lightDepartmentEngines = {
    cardiology: new DebateEngine(
      createCardiologyPanelAgents(cardioPanel.clients),
      { maxRounds: 2 },
    ),
    generalPractice: new DebateEngine(
      createGPPanelAgents(gpPanel.clients),
      { maxRounds: 2 },
    ),
    metabolic: new DebateEngine(
      createMetabolicPanelAgents(metabolicPanel.clients),
      { maxRounds: 2 },
    ),
  };

  const orchestrator = new ComplexityRoutedOrchestrator({
    env,
    fastDepartmentEngines,
    lightDepartmentEngines,
    deepDebateEngine,
    patientContextEnricher,
    authoritativeMedicalSearch:
      injectAuthoritativeEvidence ? authoritativeMedicalSearch : undefined,
    safetyOutputGuardService,
  });
  const triageUseCase = new RunTriageSessionUseCase(
    orchestrator,
    () => Date.now(),
    idempotencyStore,
  );

  const architecture: RuntimeArchitectureSnapshot = {
    experts: {
      cardiology: {
        provider: assignments.cardiology.provider,
        source: assignments.cardiology.source,
        llmEnabled: Boolean(llmClients.cardiology),
        envKey: assignments.cardiology.envKey,
      },
      generalPractice: {
        provider: assignments.generalPractice.provider,
        source: assignments.generalPractice.source,
        llmEnabled: Boolean(llmClients.generalPractice),
        envKey: assignments.generalPractice.envKey,
      },
      metabolic: {
        provider: assignments.metabolic.provider,
        source: assignments.metabolic.source,
        llmEnabled: Boolean(llmClients.metabolic),
        envKey: assignments.metabolic.envKey,
      },
      safety: {
        provider: assignments.safety.provider,
        source: assignments.safety.source,
        llmEnabled: Boolean(llmClients.safety),
        envKey: assignments.safety.envKey,
      },
    },
    routing: {
      policyVersion: 'v4.30.chapter4',
      complexityThresholds: {
        fastConsensusMax: 2,
        lightDebateMax: 5,
        deepDebateMin: 6,
      },
      panelProviders: {
        cardiology: cardioPanel.states,
        generalPractice: gpPanel.states,
        metabolic: metabolicPanel.states,
      },
    },
  };

  return {
    triageUseCase,
    architecture,
    coordinatorSnapshotService,
    governanceRuntimeTelemetry,
    authoritativeMedicalSearch,
  };
}

