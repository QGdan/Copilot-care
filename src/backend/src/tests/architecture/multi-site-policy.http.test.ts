import { AddressInfo } from 'net';
import { createBackendApp } from '../../bootstrap/createBackendApp';
import { createRuntime } from '../../bootstrap/createRuntime';

function buildEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'development',
    COPILOT_CARE_MED_SEARCH_ENABLED: 'false',
    COPILOT_CARE_MED_SEARCH_IN_TRIAGE: 'false',
    ...overrides,
  };
}

async function withServer(
  env: NodeJS.ProcessEnv,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const runtime = createRuntime(env);
  const app = createBackendApp(runtime, env);

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      try {
        await run(baseUrl);
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      } catch (error) {
        server.close(() => reject(error));
      }
    });

    server.on('error', reject);
  });
}

describe('Architecture Smoke - multi-site governance policy http loop', () => {
  it('supports site policy update and audit subscription lifecycle', async () => {
    const env = buildEnv();

    await withServer(env, async (baseUrl) => {
      const updateResponse = await fetch(
        `${baseUrl}/governance/sites/site-alpha/policy`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            displayName: 'Site Alpha Community Clinic',
            thresholds: {
              fastConsensusMax: 2,
              lightDebateMax: 4,
              deepDebateMin: 6,
            },
            ruleVersionBinding: {
              scope: 'site_override',
              catalogVersion: 'ruleset-2026.03',
              synonymSetVersion: 'synonym-2026.03',
              routingPolicyVersion: 'route-4.30',
              boundBy: 'ops-lead',
            },
            updatedBy: 'ops-lead',
          }),
        },
      );
      const updatePayload = await updateResponse.json() as {
        policy?: {
          siteId: string;
          displayName: string;
          thresholds: {
            fastConsensusMax: number;
            lightDebateMax: number;
            deepDebateMin: number;
          };
          ruleVersionBinding: {
            scope: string;
            catalogVersion: string;
          };
        };
      };

      expect(updateResponse.status).toBe(200);
      expect(updatePayload.policy?.siteId).toBe('site-alpha');
      expect(updatePayload.policy?.displayName).toBe('Site Alpha Community Clinic');
      expect(updatePayload.policy?.thresholds.fastConsensusMax).toBe(2);
      expect(updatePayload.policy?.ruleVersionBinding.scope).toBe('site_override');
      expect(updatePayload.policy?.ruleVersionBinding.catalogVersion).toBe(
        'ruleset-2026.03',
      );

      const getPolicyResponse = await fetch(
        `${baseUrl}/governance/sites/site-alpha/policy`,
      );
      const getPolicyPayload = await getPolicyResponse.json() as {
        policy?: { siteId: string; displayName: string };
      };
      expect(getPolicyResponse.status).toBe(200);
      expect(getPolicyPayload.policy?.siteId).toBe('site-alpha');
      expect(getPolicyPayload.policy?.displayName).toBe(
        'Site Alpha Community Clinic',
      );

      const subscribeResponse = await fetch(
        `${baseUrl}/governance/sites/site-alpha/audit-subscriptions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'HighRisk Alert Webhook',
            eventTypes: ['TRIAGE_ERROR', 'RULE_BLOCKED'],
            channel: 'webhook',
            endpoint: 'https://example.com/audit/hooks/high-risk',
            enabled: true,
          }),
        },
      );
      const subscribePayload = await subscribeResponse.json() as {
        siteId?: string;
        subscription?: {
          subscriptionId: string;
          channel: string;
          eventTypes: string[];
        };
      };
      expect(subscribeResponse.status).toBe(201);
      expect(subscribePayload.siteId).toBe('site-alpha');
      expect(subscribePayload.subscription?.subscriptionId).toBeTruthy();
      expect(subscribePayload.subscription?.channel).toBe('webhook');
      expect(subscribePayload.subscription?.eventTypes).toEqual([
        'TRIAGE_ERROR',
        'RULE_BLOCKED',
      ]);

      const listSubscriptionResponse = await fetch(
        `${baseUrl}/governance/sites/site-alpha/audit-subscriptions?limit=20`,
      );
      const listSubscriptionPayload = await listSubscriptionResponse.json() as {
        siteId: string;
        total: number;
        subscriptions: Array<{ subscriptionId: string; name: string }>;
      };
      expect(listSubscriptionResponse.status).toBe(200);
      expect(listSubscriptionPayload.siteId).toBe('site-alpha');
      expect(listSubscriptionPayload.total).toBeGreaterThanOrEqual(1);
      expect(
        listSubscriptionPayload.subscriptions.some(
          (item) =>
            item.subscriptionId === subscribePayload.subscription?.subscriptionId
            && item.name === 'HighRisk Alert Webhook',
        ),
      ).toBe(true);

      const listSitesResponse = await fetch(`${baseUrl}/governance/sites?limit=10`);
      const listSitesPayload = await listSitesResponse.json() as {
        total: number;
        sites: Array<{ siteId: string; displayName: string }>;
      };
      expect(listSitesResponse.status).toBe(200);
      expect(listSitesPayload.total).toBeGreaterThanOrEqual(1);
      expect(
        listSitesPayload.sites.some((item) => item.siteId === 'site-alpha'),
      ).toBe(true);

      const deleteResponse = await fetch(
        `${baseUrl}/governance/sites/site-alpha/audit-subscriptions/${subscribePayload.subscription?.subscriptionId}`,
        {
          method: 'DELETE',
        },
      );
      expect(deleteResponse.status).toBe(200);

      const afterDeleteResponse = await fetch(
        `${baseUrl}/governance/sites/site-alpha/audit-subscriptions`,
      );
      const afterDeletePayload = await afterDeleteResponse.json() as {
        subscriptions: Array<{ subscriptionId: string }>;
      };
      expect(afterDeleteResponse.status).toBe(200);
      expect(
        afterDeletePayload.subscriptions.some(
          (item) =>
            item.subscriptionId === subscribePayload.subscription?.subscriptionId,
        ),
      ).toBe(false);
    });
  });

  it('validates site policy update payload and missing site policy', async () => {
    const env = buildEnv();

    await withServer(env, async (baseUrl) => {
      const invalidSiteResponse = await fetch(
        `${baseUrl}/governance/sites/%20/policy`,
      );
      expect(invalidSiteResponse.status).toBe(400);

      const notFoundResponse = await fetch(
        `${baseUrl}/governance/sites/site-unknown/policy`,
      );
      expect(notFoundResponse.status).toBe(404);

      const invalidThresholdResponse = await fetch(
        `${baseUrl}/governance/sites/site-beta/policy`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            thresholds: {
              fastConsensusMax: 5,
              lightDebateMax: 3,
              deepDebateMin: 4,
            },
          }),
        },
      );
      const invalidThresholdPayload = await invalidThresholdResponse.json() as {
        error?: string;
      };
      expect(invalidThresholdResponse.status).toBe(400);
      expect(invalidThresholdPayload.error).toBe('invalid_thresholds');

      const invalidRuleBindingResponse = await fetch(
        `${baseUrl}/governance/sites/site-beta/policy`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            ruleVersionBinding: {
              scope: 'site_override',
            },
          }),
        },
      );
      const invalidRuleBindingPayload = await invalidRuleBindingResponse.json() as {
        error?: string;
      };
      expect(invalidRuleBindingResponse.status).toBe(400);
      expect(invalidRuleBindingPayload.error).toBe('invalid_rule_version_binding');
    });
  });

  it('validates audit subscription constraints and not-found deletion', async () => {
    const env = buildEnv();

    await withServer(env, async (baseUrl) => {
      const invalidChannelResponse = await fetch(
        `${baseUrl}/governance/sites/site-gamma/audit-subscriptions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'Bad Channel',
            eventTypes: ['TRIAGE_ERROR'],
            channel: 'sms',
            endpoint: 'https://example.com/audit',
          }),
        },
      );
      const invalidChannelPayload = await invalidChannelResponse.json() as {
        error?: string;
      };
      expect(invalidChannelResponse.status).toBe(400);
      expect(invalidChannelPayload.error).toBe('invalid_channel');

      const invalidEventTypesResponse = await fetch(
        `${baseUrl}/governance/sites/site-gamma/audit-subscriptions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'Empty Event',
            eventTypes: [],
            channel: 'webhook',
            endpoint: 'https://example.com/audit',
          }),
        },
      );
      const invalidEventTypesPayload = await invalidEventTypesResponse.json() as {
        error?: string;
      };
      expect(invalidEventTypesResponse.status).toBe(400);
      expect(invalidEventTypesPayload.error).toBe('invalid_event_types');

      const notFoundDeleteResponse = await fetch(
        `${baseUrl}/governance/sites/site-gamma/audit-subscriptions/sub-not-found`,
        {
          method: 'DELETE',
        },
      );
      const notFoundDeletePayload = await notFoundDeleteResponse.json() as {
        error?: string;
      };
      expect(notFoundDeleteResponse.status).toBe(404);
      expect(notFoundDeletePayload.error).toBe('subscription_not_found');
    });
  });
});
