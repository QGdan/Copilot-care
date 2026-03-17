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

  it('uses query variants to recover evidence when the primary query under-recalls', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      const decodedUrl = decodeURIComponent(url);
      if (decodedUrl.includes('duckduckgo.com/html') && decodedUrl.includes('hypertension guideline')) {
        return '';
      }
      if (
        decodedUrl.includes('duckduckgo.com/html') &&
        decodedUrl.includes('high blood pressure diagnosis threshold')
      ) {
        return [
          '<div class="result">',
          '<a class="result__a" href="https://www.who.int/news-room/fact-sheets/detail/hypertension">WHO Hypertension Fact Sheet</a>',
          '<div class="result__snippet">WHO recommends reducing sodium intake and regular blood pressure screening.</div>',
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
      queryVariants: [
        'hypertension guideline',
        'high blood pressure diagnosis threshold',
      ],
      limit: 2,
      sourceFilter: ['WHO'],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.sourceId).toBe('WHO');
    expect(result.realtimeCount).toBe(1);
    expect(result.fallbackCount).toBe(0);
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
      result.results.every(
        (item) =>
          item.snippet.includes('证据要点：') &&
          item.snippet.includes('临床解读：') &&
          item.snippet.includes('建议动作：'),
      ),
    ).toBe(true);
    expect(result.results.every((item) => !item.snippet.includes('catalog_seed'))).toBe(true);
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

  it('keeps realtime-only output when partial-seed-fill is enabled but live coverage is sufficient', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('duckduckgo.com/html')) {
        return [
          '<div class="result">',
          '<a class="result__a" href="https://www.who.int/news-room/fact-sheets/detail/hypertension">WHO Hypertension Fact Sheet</a>',
          '<div class="result__snippet">WHO recommends reducing sodium intake and regular blood pressure screening in adults.</div>',
          '</div>',
          '<div class="result">',
          '<a class="result__a" href="https://www.nice.org.uk/guidance/ng136/chapter/Recommendations">NICE Hypertension Guideline</a>',
          '<div class="result__snippet">NICE recommends structured blood pressure follow-up and risk stratification.</div>',
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
        allowPartialSeedFill: true,
      },
      httpGetText,
    );

    const result = await service.search({
      query: 'hypertension guideline',
      limit: 4,
      sourceFilter: ['WHO', 'NICE'],
      requiredSources: ['WHO', 'NICE'],
    });

    expect(result.realtimeCount).toBe(2);
    expect(result.fallbackCount).toBe(0);
    expect(result.usedSources).toEqual(expect.arrayContaining(['WHO', 'NICE']));
  });

  it('does not force catalog fallback when only required-source coverage is missing', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('duckduckgo.com/html')) {
        return [
          '<div class="result">',
          '<a class="result__a" href="https://www.who.int/news-room/fact-sheets/detail/hypertension">WHO Hypertension Fact Sheet</a>',
          '<div class="result__snippet">WHO recommends regular blood pressure screening.</div>',
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
      sourceFilter: ['WHO', 'NICE'],
      requiredSources: ['WHO', 'NICE'],
    });

    expect(result.realtimeCount).toBeGreaterThanOrEqual(1);
    expect(result.fallbackCount).toBe(0);
    expect(result.fallbackReasons).toEqual([]);
    expect(result.missingRequiredSources).toEqual(['NICE']);
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
    expect(result.results[0]?.snippet).toContain('\u6765\u6e90\uff1a');
    expect(result.results[0]?.snippet).toMatch(/\u51cf\u5c11|\u9650\u76d0/);
    expect(/[A-Za-z]{3,}/.test(result.results[0]?.snippet ?? '')).toBe(false);
    expect(result.realtimeCount).toBe(1);
    expect(result.fallbackCount).toBe(0);
  });

  it('accepts alternate ddg anchor/snippet markup variants', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('duckduckgo.com/html')) {
        return [
          '<div class="result">',
          '<a class="result-link" href="https://www.cdc.gov/high-blood-pressure/about/index.html">CDC Blood Pressure</a>',
          '<div class="result-snippet">Regular blood pressure screening helps identify silent hypertension.</div>',
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
      sourceFilter: ['CDC_US'],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.sourceId).toBe('CDC_US');
    expect(result.results[0]?.snippet).toContain('\u6765\u6e90\uff1a');
    expect(/[A-Za-z]{3,}/.test(result.results[0]?.snippet ?? '')).toBe(false);
    expect(result.realtimeCount).toBe(1);
    expect(result.fallbackCount).toBe(0);
  });

  it('resolves full duckduckgo redirect urls to authoritative source urls', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('duckduckgo.com/html')) {
        return [
          '<div class="result">',
          '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.who.int%2Fnews-room%2Ffact-sheets%2Fdetail%2Fhypertension">WHO Hypertension</a>',
          '<div class="result__snippet">WHO guidance for blood pressure control.</div>',
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
    expect(result.results[0]?.snippet).toContain('\u6765\u6e90\uff1a');
    expect(result.results[0]?.snippet).toContain('\u8bc1\u636e\u8981\u70b9\uff1a');
    expect(/[A-Za-z]{3,}/.test(result.results[0]?.snippet ?? '')).toBe(false);
    expect(result.realtimeCount).toBe(1);
    expect(result.fallbackCount).toBe(0);
  });

  it('accepts authoritative hosts without www prefix', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('duckduckgo.com/html')) {
        return [
          '<div class="result">',
          '<a class="result__a" href="https://who.int/news-room/fact-sheets/detail/hypertension">WHO Hypertension</a>',
          '<div class="result__snippet">WHO hypertension guidance.</div>',
          '</div>',
          '<div class="result">',
          '<a class="result__a" href="https://nice.org.uk/guidance/ng136/chapter/Recommendations">NICE Guidance</a>',
          '<div class="result__snippet">NICE blood pressure recommendations.</div>',
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
      limit: 3,
      sourceFilter: ['WHO', 'NICE'],
      requiredSources: ['WHO', 'NICE'],
    });

    expect(result.results.length).toBe(2);
    expect(result.usedSources).toEqual(expect.arrayContaining(['WHO', 'NICE']));
    expect(result.fallbackCount).toBe(0);
    expect(result.realtimeCount).toBe(2);
  });

  it('parses PubMed payload wrapped by code fences', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('esearch.fcgi')) {
        return [
          '```json',
          '{"esearchresult":{"idlist":["71001"]}}',
          '```',
        ].join('\n');
      }
      if (url.includes('esummary.fcgi')) {
        return [
          '```json',
          '{"result":{"71001":{"title":"PubMed fenced payload","fulljournalname":"PubMed Journal","pubdate":"2026"}}}',
          '```',
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
        duckDuckGoEnabled: false,
      },
      httpGetText,
    );

    const result = await service.search({
      query: 'hypertension guideline',
      limit: 2,
      sourceFilter: ['PUBMED'],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.sourceId).toBe('PUBMED');
    expect(result.realtimeCount).toBe(1);
    expect(result.fallbackCount).toBe(0);
  });

  it('probes authoritative seed pages as realtime recovery when providers miss', async () => {
    const httpGetText = jest.fn(async (url: string) => {
      if (url.includes('www.who.int')) {
        return [
          '<html>',
          '<head><title>WHO hypertension fact sheet</title><meta name="description" content="Blood pressure control with sodium reduction and regular screening."/></head>',
          '<body><p>WHO recommends long-term blood pressure monitoring.</p></body>',
          '</html>',
        ].join('');
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
      },
      httpGetText,
      {
        providers: [],
      },
    );

    const result = await service.search({
      query: 'hypertension guideline',
      limit: 3,
      sourceFilter: ['WHO'],
      requiredSources: ['WHO'],
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.usedSources).toContain('WHO');
    expect(result.realtimeCount).toBeGreaterThan(0);
    expect(result.fallbackCount).toBe(0);
    expect(service.getRuntimeStats().fallbackAppliedCount).toBe(0);
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
    expect(httpGetText).toHaveBeenCalledTimes(3);

    const second = await service.search({
      query: 'hypertension guideline',
      limit: 3,
      sourceFilter: ['PUBMED'],
    });
    expect(second).toEqual(first);
    expect(httpGetText).toHaveBeenCalledTimes(3);
  });

  it('does not cache fallback-heavy results when network mode is enabled', async () => {
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
    const second = await service.search({
      query: 'hypertension guideline',
      limit: 3,
      sourceFilter: ['PUBMED'],
    });

    expect(first.fallbackCount).toBeGreaterThan(0);
    expect(second.fallbackCount).toBeGreaterThan(0);
    expect(httpGetText).toHaveBeenCalledTimes(2);
    const runtime = service.getRuntimeStats();
    expect(runtime.cacheHits).toBe(0);
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

  it('records recent retrieval traces with fallback diagnostics', async () => {
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
        recentSearchLogLimit: 8,
      },
      httpGetText,
    );

    const result = await service.search({
      query: 'hypertension guideline',
      limit: 3,
      sourceFilter: ['PUBMED'],
      requiredSources: ['PUBMED'],
    });
    expect(result.fallbackCount).toBeGreaterThan(0);

    const runtime = service.getRuntimeStats();
    expect(runtime.recentSearches?.length).toBeGreaterThan(0);
    expect(runtime.recentSearches?.[0]?.query).toBe('hypertension guideline');
    expect(runtime.recentSearches?.[0]?.requiredSources).toEqual(['PUBMED']);
    expect(runtime.recentSearches?.[0]?.fallbackReasons).toEqual(
      expect.arrayContaining(['no_candidates']),
    );
  });

  it('enables hybrid retrieval fusion behind feature flag', async () => {
    const service = new AuthoritativeMedicalWebSearchService({
      enabled: true,
      networkEnabled: false,
      timeoutMs: 2000,
      maxResults: 8,
      pubMedRetMax: 6,
      duckDuckGoEnabled: true,
      hybridRetrievalEnabled: true,
    });

    const result = await service.search({
      query: 'hypertension guideline',
      limit: 4,
      sourceFilter: ['WHO', 'CDC_US', 'PUBMED'],
      requiredSources: ['WHO', 'CDC_US'],
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.strategyVersion).toContain('+hybrid-v1');
    expect(result.results.every((item) => isAuthoritativeMedicalUrl(item.url))).toBe(
      true,
    );
  });
});

