import {
  AuditSubscription,
  AuditSubscriptionChannel,
  RuleVersionBinding,
  SiteGovernancePolicy,
} from '@copilot-care/shared/types';
import {
  InMemorySiteGovernancePolicyStore,
  SiteGovernancePolicyPersistentState,
  SiteGovernancePolicyStore,
} from './SiteGovernancePolicyStore';

const DEFAULT_THRESHOLDS: SiteGovernancePolicy['thresholds'] = {
  fastConsensusMax: 2,
  lightDebateMax: 5,
  deepDebateMin: 6,
};

export interface SiteGovernancePolicyServiceOptions {
  store?: SiteGovernancePolicyStore;
  defaultThresholds?: SiteGovernancePolicy['thresholds'];
  defaultRuleVersionBinding?: Partial<RuleVersionBinding>;
  now?: () => Date;
}

export interface ListSiteGovernancePoliciesInput {
  limit?: number;
}

export interface UpsertSiteGovernancePolicyInput {
  siteId: string;
  displayName?: string;
  thresholds?: SiteGovernancePolicy['thresholds'];
  ruleVersionBinding?: RuleVersionBinding;
  updatedBy?: string;
}

export interface ListAuditSubscriptionsInput {
  siteId: string;
  limit?: number;
}

export interface AddAuditSubscriptionInput {
  siteId: string;
  name: string;
  eventTypes: string[];
  channel: AuditSubscriptionChannel;
  endpoint: string;
  secretRef?: string;
  enabled?: boolean;
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function clonePolicy(policy: SiteGovernancePolicy): SiteGovernancePolicy {
  return JSON.parse(JSON.stringify(policy)) as SiteGovernancePolicy;
}

function normalizeState(
  state: SiteGovernancePolicyPersistentState | undefined,
): SiteGovernancePolicyPersistentState {
  if (!state || typeof state !== 'object' || !state.policies) {
    return { policies: {} };
  }
  return state;
}

function normalizeLimit(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number' ? value : Number(value ?? Number.NaN);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(200, Math.max(1, Math.floor(parsed)));
}

function createSubscriptionId(): string {
  return `audit-sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class SiteGovernancePolicyService {
  private readonly store: SiteGovernancePolicyStore;
  private readonly now: () => Date;
  private readonly defaultThresholds: SiteGovernancePolicy['thresholds'];
  private readonly defaultRuleVersionBinding: Partial<RuleVersionBinding>;
  private readonly policies: Map<string, SiteGovernancePolicy>;

  constructor(options: SiteGovernancePolicyServiceOptions = {}) {
    this.store = options.store ?? new InMemorySiteGovernancePolicyStore();
    this.now = options.now ?? (() => new Date());
    this.defaultThresholds = options.defaultThresholds ?? DEFAULT_THRESHOLDS;
    this.defaultRuleVersionBinding = options.defaultRuleVersionBinding ?? {};
    this.policies = new Map<string, SiteGovernancePolicy>();

    const persisted = normalizeState(this.store.load());
    for (const [siteId, policy] of Object.entries(persisted.policies)) {
      if (!policy || typeof policy !== 'object') {
        continue;
      }
      if (!siteId.trim()) {
        continue;
      }
      this.policies.set(siteId, clonePolicy(policy));
    }
  }

  private buildDefaultRuleVersionBinding(): RuleVersionBinding {
    return {
      scope: this.defaultRuleVersionBinding.scope ?? 'global',
      catalogVersion:
        this.defaultRuleVersionBinding.catalogVersion ?? 'unknown',
      synonymSetVersion: this.defaultRuleVersionBinding.synonymSetVersion,
      routingPolicyVersion:
        this.defaultRuleVersionBinding.routingPolicyVersion,
      boundAt:
        this.defaultRuleVersionBinding.boundAt
        ?? nowIso(this.now),
      boundBy:
        this.defaultRuleVersionBinding.boundBy ?? 'runtime_default',
    };
  }

  private createDefaultPolicy(siteId: string): SiteGovernancePolicy {
    const timestamp = nowIso(this.now);
    return {
      siteId,
      displayName: siteId,
      thresholds: {
        fastConsensusMax: this.defaultThresholds.fastConsensusMax,
        lightDebateMax: this.defaultThresholds.lightDebateMax,
        deepDebateMin: this.defaultThresholds.deepDebateMin,
      },
      ruleVersionBinding: this.buildDefaultRuleVersionBinding(),
      auditSubscriptions: [],
      updatedAt: timestamp,
      updatedBy: 'runtime_default',
    };
  }

  private persist(): void {
    const policies: SiteGovernancePolicyPersistentState['policies'] = {};
    for (const [siteId, policy] of this.policies.entries()) {
      policies[siteId] = clonePolicy(policy);
    }
    this.store.save({ policies });
  }

  private ensurePolicy(siteId: string): SiteGovernancePolicy {
    const normalizedSiteId = siteId.trim();
    const existing = this.policies.get(normalizedSiteId);
    if (existing) {
      return existing;
    }
    const created = this.createDefaultPolicy(normalizedSiteId);
    this.policies.set(normalizedSiteId, created);
    this.persist();
    return created;
  }

  public list(input: ListSiteGovernancePoliciesInput = {}): SiteGovernancePolicy[] {
    const limit = normalizeLimit(input.limit, 50);
    return [...this.policies.values()]
      .sort((left, right) => {
        return (
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
      })
      .slice(0, limit)
      .map((item) => clonePolicy(item));
  }

  public get(siteId: string): SiteGovernancePolicy | undefined {
    const policy = this.policies.get(siteId.trim());
    return policy ? clonePolicy(policy) : undefined;
  }

  public upsertPolicy(input: UpsertSiteGovernancePolicyInput): SiteGovernancePolicy {
    const normalizedSiteId = input.siteId.trim();
    const existing = this.ensurePolicy(normalizedSiteId);
    const timestamp = nowIso(this.now);
    const next: SiteGovernancePolicy = {
      ...existing,
      displayName: input.displayName?.trim() || existing.displayName,
      thresholds: input.thresholds ?? existing.thresholds,
      ruleVersionBinding: input.ruleVersionBinding ?? existing.ruleVersionBinding,
      updatedAt: timestamp,
      updatedBy: input.updatedBy?.trim() || existing.updatedBy,
    };
    this.policies.set(normalizedSiteId, next);
    this.persist();
    return clonePolicy(next);
  }

  public listAuditSubscriptions(
    input: ListAuditSubscriptionsInput,
  ): AuditSubscription[] {
    const policy = this.policies.get(input.siteId.trim());
    if (!policy) {
      return [];
    }
    const limit = normalizeLimit(input.limit, 100);
    return [...policy.auditSubscriptions]
      .sort((left, right) => {
        return (
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
      })
      .slice(0, limit)
      .map((item) => JSON.parse(JSON.stringify(item)) as AuditSubscription);
  }

  public addAuditSubscription(input: AddAuditSubscriptionInput): AuditSubscription {
    const normalizedSiteId = input.siteId.trim();
    const policy = this.ensurePolicy(normalizedSiteId);
    const timestamp = nowIso(this.now);
    const subscription: AuditSubscription = {
      subscriptionId: createSubscriptionId(),
      siteId: normalizedSiteId,
      name: input.name.trim(),
      eventTypes: [...new Set(input.eventTypes.map((item) => item.trim()))],
      channel: input.channel,
      endpoint: input.endpoint.trim(),
      secretRef: input.secretRef?.trim() || undefined,
      enabled: input.enabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const next: SiteGovernancePolicy = {
      ...policy,
      auditSubscriptions: [subscription, ...policy.auditSubscriptions],
      updatedAt: timestamp,
      updatedBy: policy.updatedBy,
    };
    this.policies.set(normalizedSiteId, next);
    this.persist();

    return JSON.parse(JSON.stringify(subscription)) as AuditSubscription;
  }

  public removeAuditSubscription(
    siteId: string,
    subscriptionId: string,
  ): boolean {
    const normalizedSiteId = siteId.trim();
    const normalizedSubscriptionId = subscriptionId.trim();
    const policy = this.policies.get(normalizedSiteId);
    if (!policy) {
      return false;
    }

    const nextSubscriptions = policy.auditSubscriptions.filter(
      (item) => item.subscriptionId !== normalizedSubscriptionId,
    );
    if (nextSubscriptions.length === policy.auditSubscriptions.length) {
      return false;
    }

    const next: SiteGovernancePolicy = {
      ...policy,
      auditSubscriptions: nextSubscriptions,
      updatedAt: nowIso(this.now),
    };
    this.policies.set(normalizedSiteId, next);
    this.persist();
    return true;
  }
}
