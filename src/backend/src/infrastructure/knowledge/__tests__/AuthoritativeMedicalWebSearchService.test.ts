import {
  AuthoritativeMedicalWebSearchService,
  createAuthoritativeMedicalSearchService,
} from '../AuthoritativeMedicalWebSearchService';
import { isAuthoritativeMedicalUrl } from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';

describe('AuthoritativeMedicalWebSearchService', () => {
  it('returns whitelisted authoritative results for a clinical query', async () => {
    const service = createAuthoritativeMedicalSearchService({
      NODE_ENV: 'test',
      COPILOT_CARE_MED_SEARCH_ENABLED: 'true',
    } as NodeJS.ProcessEnv);

    const result = await service.search({
      query: 'hypertension guideline',
      limit: 5,
    });

    expect(service.isEnabled()).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((item) => isAuthoritativeMedicalUrl(item.url))).toBe(
      true,
    );
    expect(result.usedSources.length).toBeGreaterThan(0);
    expect(result.strategyVersion).toContain('authority-multisource-v');
    expect(result.sourceBreakdown.length).toBeGreaterThan(0);
  });

  it('returns empty results for invalid short query', async () => {
    const service = createAuthoritativeMedicalSearchService({
      NODE_ENV: 'test',
      COPILOT_CARE_MED_SEARCH_ENABLED: 'true',
    } as NodeJS.ProcessEnv);

    const result = await service.search({
      query: ' ',
      limit: 5,
    });

    expect(result.results).toEqual([]);
    expect(result.usedSources).toEqual([]);
    expect(result.sourceBreakdown).toEqual([]);
    expect(result.strategyVersion).toContain('authority-multisource-v');
  });

  it('respects disabled toggle and does not run search', async () => {
    const service = createAuthoritativeMedicalSearchService({
      NODE_ENV: 'test',
      COPILOT_CARE_MED_SEARCH_ENABLED: 'false',
    } as NodeJS.ProcessEnv);

    const result = await service.search({
      query: 'diabetes',
      limit: 5,
    });

    expect(service.isEnabled()).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.usedSources).toEqual([]);
    expect(result.sourceBreakdown).toEqual([]);
    expect(result.strategyVersion).toContain('authority-multisource-v');
  });

  it('prioritizes diversified non-PUBMED sources when available', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('esearch.fcgi')) {
        return JSON.stringify({
          esearchresult: {
            idlist: ['1001', '1002', '1003', '1004'],
          },
        });
      }
      if (url.includes('esummary.fcgi')) {
        return JSON.stringify({
          result: {
            '1001': {
              title: 'PubMed evidence A',
              fulljournalname: 'PubMed Journal',
              pubdate: '2025',
            },
            '1002': {
              title: 'PubMed evidence B',
              fulljournalname: 'PubMed Journal',
              pubdate: '2025',
            },
            '1003': {
              title: 'PubMed evidence C',
              fulljournalname: 'PubMed Journal',
              pubdate: '2025',
            },
            '1004': {
              title: 'PubMed evidence D',
              fulljournalname: 'PubMed Journal',
              pubdate: '2025',
            },
          },
        });
      }
      if (url.includes('duckduckgo.com/html')) {
        return [
          '<a class="result__a" href="https://www.nice.org.uk/guidance/ng136/chapter/Recommendations">NICE Guidance</a>',
          '<a class="result__a" href="https://www.who.int/news-room/fact-sheets/detail/hypertension">WHO Factsheet</a>',
          '<a class="result__a" href="https://www.cdc.gov/high-blood-pressure/about/index.html">CDC High BP</a>',
        ].join('\n');
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const service = new AuthoritativeMedicalWebSearchService(
      {
        enabled: true,
        networkEnabled: true,
        timeoutMs: 2000,
        maxResults: 8,
        pubMedRetMax: 6,
        duckDuckGoEnabled: true,
      },
      httpGetText,
    );

    const result = await service.search({
      query: 'hypertension guideline',
      limit: 4,
    });

    expect(result.results).toHaveLength(4);
    expect(result.results[0]?.sourceId).not.toBe('PUBMED');
    expect(result.usedSources).toEqual(
      expect.arrayContaining(['NICE', 'WHO', 'CDC_US', 'PUBMED']),
    );
    expect(
      result.sourceBreakdown.some((item) => item.sourceId === 'PUBMED'),
    ).toBe(true);
    expect(result.results.every((item) => isAuthoritativeMedicalUrl(item.url))).toBe(
      true,
    );
  });

  it('builds ddg whitelist queries without PUBMED and keeps aggregate recall query', async () => {
    const requestedUrls: string[] = [];
    const httpGetText = jest.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url.includes('esearch.fcgi')) {
        return JSON.stringify({
          esearchresult: { idlist: ['2001'] },
        });
      }
      if (url.includes('esummary.fcgi')) {
        return JSON.stringify({
          result: {
            '2001': {
              title: 'PubMed evidence only',
              fulljournalname: 'PubMed Journal',
              pubdate: '2025',
            },
          },
        });
      }
      if (url.includes('duckduckgo.com/html')) {
        return '<a class="result__a" href="https://www.nice.org.uk/guidance/ng136">NICE</a>';
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const service = new AuthoritativeMedicalWebSearchService(
      {
        enabled: true,
        networkEnabled: true,
        timeoutMs: 2000,
        maxResults: 8,
        pubMedRetMax: 6,
        duckDuckGoEnabled: true,
      },
      httpGetText,
    );

    await service.search({
      query: 'hypertension guideline',
      limit: 3,
    });

    const ddgUrls = requestedUrls.filter((url) => url.includes('duckduckgo.com/html'));
    expect(ddgUrls.length).toBeGreaterThan(0);
    const decodedDdgUrls = ddgUrls.map((url) => decodeURIComponent(url));
    expect(
      decodedDdgUrls.some(
        (url) =>
          url.includes('site:www.nice.org.uk') &&
          url.includes('site:www.who.int') &&
          url.includes('site:www.cdc.gov'),
      ),
    ).toBe(true);
    expect(
      decodedDdgUrls.every(
        (url) => !url.includes('site:pubmed.ncbi.nlm.nih.gov'),
      ),
    ).toBe(true);
  });

  it('prioritizes per-source ddg query order by authority rank', async () => {
    const requestedUrls: string[] = [];
    const httpGetText = jest.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url.includes('duckduckgo.com/html')) {
        return '';
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const service = new AuthoritativeMedicalWebSearchService(
      {
        enabled: true,
        networkEnabled: true,
        timeoutMs: 2000,
        maxResults: 8,
        pubMedRetMax: 6,
        duckDuckGoEnabled: true,
      },
      httpGetText,
    );

    await service.search({
      query: 'hypertension guideline',
      limit: 3,
      sourceFilter: ['CDC_US', 'WHO', 'NICE'],
    });

    const decodedDdgUrls = requestedUrls
      .filter((url) => url.includes('duckduckgo.com/html'))
      .map((url) => decodeURIComponent(url));

    expect(decodedDdgUrls).toHaveLength(4);
    expect(decodedDdgUrls[0]).toContain('site:www.nice.org.uk');
    expect(decodedDdgUrls[1]).toContain('site:www.who.int');
    expect(decodedDdgUrls[2]).toContain('site:www.cdc.gov');
    expect(decodedDdgUrls[3]).toContain('site:www.nice.org.uk');
    expect(decodedDdgUrls[3]).toContain('site:www.who.int');
    expect(decodedDdgUrls[3]).toContain('site:www.cdc.gov');
  });

  it('applies sourceFilter to fallback evidence when network is unavailable', async () => {
    const service = new AuthoritativeMedicalWebSearchService({
      enabled: true,
      networkEnabled: false,
      timeoutMs: 2000,
      maxResults: 8,
      pubMedRetMax: 6,
      duckDuckGoEnabled: true,
    });

    const result = await service.search({
      query: 'public health guidance',
      limit: 4,
      sourceFilter: ['WHO'],
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((item) => item.sourceId === 'WHO')).toBe(true);
    expect(result.usedSources).toEqual(['WHO']);
    expect(result.fallbackCount).toBe(result.results.length);
    expect(result.realtimeCount).toBe(0);
    expect(
      result.results.every((item) => item.snippet.trim().length > 0),
    ).toBe(true);
    expect(
      result.results.every((item) => !item.snippet.includes('目录兜底')),
    ).toBe(true);
  });

  it('does not pad seed fallback when realtime evidence already exists by default', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('esearch.fcgi')) {
        return JSON.stringify({
          esearchresult: {
            idlist: ['31001'],
          },
        });
      }
      if (url.includes('esummary.fcgi')) {
        return JSON.stringify({
          result: {
            '31001': {
              title: 'PubMed realtime evidence',
              fulljournalname: 'PubMed Journal',
              pubdate: '2025',
            },
          },
        });
      }
      if (url.includes('duckduckgo.com/html')) {
        return [
          '<div class="result">',
          '<a class="result__a" href="https://www.who.int/news-room/fact-sheets/detail/hypertension">WHO Hypertension Fact Sheet</a>',
          '<div class="result__snippet">WHO recommends reducing sodium intake and regular blood pressure screening in adults.</div>',
          '</div>',
        ].join('\n');
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const service = new AuthoritativeMedicalWebSearchService(
      {
        enabled: true,
        networkEnabled: true,
        timeoutMs: 2000,
        maxResults: 8,
        pubMedRetMax: 6,
        duckDuckGoEnabled: true,
      },
      httpGetText,
    );

    const result = await service.search({
      query: 'hypertension guideline',
      limit: 4,
    });

    expect(result.results.length).toBe(2);
    expect(result.usedSources).toEqual(
      expect.arrayContaining(['WHO', 'PUBMED']),
    );
    expect(result.realtimeCount).toBe(2);
    expect(result.fallbackCount).toBe(0);
  });

  it('extracts ddg snippet and renders Chinese evidence summary', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('duckduckgo.com/html')) {
        return [
          '<div class="result">',
          '<a class="result__a" href="https://www.who.int/news-room/fact-sheets/detail/hypertension">WHO Hypertension Fact Sheet</a>',
          '<div class="result__snippet">WHO recommends reducing sodium intake and increasing physical activity for blood pressure control.</div>',
          '</div>',
        ].join('\n');
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const service = new AuthoritativeMedicalWebSearchService(
      {
        enabled: true,
        networkEnabled: true,
        timeoutMs: 2000,
        maxResults: 8,
        pubMedRetMax: 6,
        duckDuckGoEnabled: true,
      },
      httpGetText,
    );

    const result = await service.search({
      query: 'hypertension guideline',
      limit: 2,
      sourceFilter: ['WHO'],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.sourceId).toBe('WHO');
    expect(result.results[0]?.snippet).toContain('World Health Organization');
    expect(result.results[0]?.snippet).toContain('减少钠盐摄入');
    expect(result.realtimeCount).toBe(1);
    expect(result.fallbackCount).toBe(0);
  });

  it('reuses cached result for repeated identical query within ttl', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('esearch.fcgi')) {
        return JSON.stringify({
          esearchresult: { idlist: ['51001'] },
        });
      }
      if (url.includes('esummary.fcgi')) {
        return JSON.stringify({
          result: {
            '51001': {
              title: 'PubMed cached evidence',
              fulljournalname: 'PubMed Journal',
              pubdate: '2026',
            },
          },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const service = new AuthoritativeMedicalWebSearchService(
      {
        enabled: true,
        networkEnabled: true,
        timeoutMs: 2000,
        maxResults: 8,
        pubMedRetMax: 6,
        duckDuckGoEnabled: false,
        cacheTtlMs: 120000,
        cacheMaxEntries: 16,
      },
      httpGetText,
    );

    const first = await service.search({
      query: 'hypertension guideline',
      limit: 3,
      sourceFilter: ['PUBMED'],
    });
    expect(first.results.length).toBeGreaterThan(0);
    expect(httpGetText).toHaveBeenCalledTimes(2);

    const second = await service.search({
      query: 'hypertension guideline',
      limit: 3,
      sourceFilter: ['PUBMED'],
    });
    expect(second).toEqual(first);
    expect(httpGetText).toHaveBeenCalledTimes(2);
  });

  it('enforces requiredSources coverage when candidates are available', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('duckduckgo.com/html')) {
        return [
          '<a class="result__a" href="https://www.nice.org.uk/guidance/ng136/chapter/Recommendations">NICE Guidance</a>',
          '<a class="result__a" href="https://www.who.int/news-room/fact-sheets/detail/hypertension">WHO Factsheet</a>',
          '<a class="result__a" href="https://www.cdc.gov/high-blood-pressure/about/index.html">CDC High BP</a>',
        ].join('\n');
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const service = new AuthoritativeMedicalWebSearchService(
      {
        enabled: true,
        networkEnabled: true,
        timeoutMs: 2000,
        maxResults: 8,
        pubMedRetMax: 6,
        duckDuckGoEnabled: true,
      },
      httpGetText,
    );

    const result = await service.search({
      query: 'hypertension guideline',
      limit: 2,
      sourceFilter: ['NICE', 'WHO', 'CDC_US'],
      requiredSources: ['WHO', 'CDC_US'],
    });

    expect(result.results).toHaveLength(2);
    expect(result.usedSources).toEqual(
      expect.arrayContaining(['WHO', 'CDC_US']),
    );
    expect(result.usedSources).not.toContain('PUBMED');
  });

  it('opens provider circuit after repeated failures and skips further calls', async () => {
    const httpGetText = jest.fn(async () => {
      throw new Error('network down');
    });
    const service = new AuthoritativeMedicalWebSearchService(
      {
        enabled: true,
        networkEnabled: true,
        timeoutMs: 2000,
        maxResults: 8,
        pubMedRetMax: 6,
        duckDuckGoEnabled: false,
        providerFailureThreshold: 2,
        providerCircuitOpenMs: 600000,
        allowPartialSeedFill: false,
      },
      httpGetText,
    );

    await service.search({
      query: 'hypertension guideline',
      limit: 3,
      sourceFilter: ['PUBMED'],
    });
    await service.search({
      query: 'diabetes guideline',
      limit: 3,
      sourceFilter: ['PUBMED'],
    });
    const networkCallsBeforeCircuitSkip = httpGetText.mock.calls.length;

    await service.search({
      query: 'stroke guideline',
      limit: 3,
      sourceFilter: ['PUBMED'],
    });

    expect(httpGetText).toHaveBeenCalledTimes(networkCallsBeforeCircuitSkip);
    const runtime = service.getRuntimeStats();
    const pubMedRuntime = runtime.providerStats.find(
      (item) => item.providerId === 'PUBMED',
    );
    expect(pubMedRuntime?.failures).toBeGreaterThanOrEqual(2);
    expect(pubMedRuntime?.skippedByCircuit).toBeGreaterThanOrEqual(1);
    expect(pubMedRuntime?.circuitState).toBe('open');
  });

  it('tracks runtime counters including cache and fallback usage', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('esearch.fcgi')) {
        return JSON.stringify({
          esearchresult: { idlist: ['62001'] },
        });
      }
      if (url.includes('esummary.fcgi')) {
        return JSON.stringify({
          result: {
            '62001': {
              title: 'PubMed runtime stats evidence',
              fulljournalname: 'PubMed Journal',
              pubdate: '2026',
            },
          },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const service = new AuthoritativeMedicalWebSearchService(
      {
        enabled: true,
        networkEnabled: true,
        timeoutMs: 2000,
        maxResults: 8,
        pubMedRetMax: 6,
        duckDuckGoEnabled: false,
        cacheTtlMs: 120000,
        cacheMaxEntries: 16,
      },
      httpGetText,
    );

    await service.search({
      query: 'hypertension guideline',
      limit: 3,
      sourceFilter: ['PUBMED'],
    });
    await service.search({
      query: 'hypertension guideline',
      limit: 3,
      sourceFilter: ['PUBMED'],
    });
    await service.search({
      query: 'stroke emergency triage',
      limit: 3,
      sourceFilter: ['WHO'],
    });

    const runtime = service.getRuntimeStats();
    expect(runtime.searches).toBe(3);
    expect(runtime.cacheHits).toBe(1);
    expect(runtime.cacheMisses).toBe(2);
    expect(runtime.fallbackAppliedCount).toBeGreaterThanOrEqual(1);
  });
});
