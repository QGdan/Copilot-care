import { AuthoritativeMedicalSource } from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import { compareSourceOrder } from './sourcePolicy';
import {
  decodeHtmlEntities,
  normalizeWhitespace,
  stripHtml,
} from './text';
import { DdgQueryPlan } from './types';

function toSearchSiteTerms(sources: AuthoritativeMedicalSource[]): string[] {
  const allRules = sources.flatMap((source) => source.hostRules);
  const normalized = allRules.map((rule) =>
    rule.startsWith('*.') ? rule.slice(2) : rule,
  );
  return [...new Set(normalized)].sort();
}

function buildSearchSiteClause(siteTerms: string[]): string {
  return siteTerms.map((item) => `site:${item}`).join(' OR ');
}

function buildDuckDuckGoQueryPlans(
  query: string,
  sources: AuthoritativeMedicalSource[],
): DdgQueryPlan[] {
  const orderedSources = [...sources].sort((left, right) =>
    compareSourceOrder(left.id, right.id),
  );
  const queryDedup = new Set<string>();
  const plans: DdgQueryPlan[] = [];

  const pushPlan = (searchQuery: string, sourceId?: string): void => {
    const normalized = normalizeWhitespace(searchQuery);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (queryDedup.has(key)) {
      return;
    }
    queryDedup.add(key);
    plans.push({ sourceId, searchQuery: normalized });
  };

  for (const source of orderedSources) {
    const siteTerms = toSearchSiteTerms([source]);
    if (siteTerms.length === 0) {
      continue;
    }
    pushPlan(
      `${query} (${buildSearchSiteClause(siteTerms)})`,
      source.id,
    );
  }

  const aggregateSiteTerms = toSearchSiteTerms(orderedSources);
  if (aggregateSiteTerms.length > 0) {
    pushPlan(`${query} (${buildSearchSiteClause(aggregateSiteTerms)})`);
  }

  return plans;
}

function resolveSearchResultUrl(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) {
    return null;
  }

  const resolveDuckDuckGoRedirect = (value: string): string | null => {
    try {
      const target = new URL(value);
      if (!/duckduckgo\.com$/i.test(target.hostname)) {
        return null;
      }
      if (!target.pathname.startsWith('/l/')) {
        return null;
      }
      const decoded = target.searchParams.get('uddg');
      return decoded ? decodeURIComponent(decoded) : null;
    } catch {
      return null;
    }
  };

  if (href.startsWith('http://') || href.startsWith('https://')) {
    const redirected = resolveDuckDuckGoRedirect(href);
    if (redirected) {
      return redirected;
    }
    return href;
  }

  if (href.startsWith('/l/?')) {
    try {
      const target = new URL(`https://duckduckgo.com${href}`);
      const decoded = target.searchParams.get('uddg');
      if (decoded) {
        return decodeURIComponent(decoded);
      }
      return null;
    } catch {
      return null;
    }
  }

  if (href.startsWith('//')) {
    return `https:${href}`;
  }

  return null;
}

function extractSearchSnippetNearAnchor(
  html: string,
  anchorIndex: number,
): string {
  if (anchorIndex < 0 || anchorIndex >= html.length) {
    return '';
  }

  const windowText = html.slice(
    anchorIndex,
    Math.min(html.length, anchorIndex + 1800),
  );
  const snippetPatterns: RegExp[] = [
    /class=(?:"[^"]*result__snippet[^"]*"|'[^']*result__snippet[^']*')[^>]*>([\s\S]*?)<\/[^>]+>/i,
    /class=(?:"[^"]*result-snippet[^"]*"|'[^']*result-snippet[^']*')[^>]*>([\s\S]*?)<\/[^>]+>/i,
    /class=(?:"[^"]*\bsnippet\b[^"]*"|'[^']*\bsnippet\b[^']*')[^>]*>([\s\S]*?)<\/[^>]+>/i,
    /<p[^>]*>([\s\S]*?)<\/p>/i,
  ];

  for (const pattern of snippetPatterns) {
    const snippetMatch = pattern.exec(windowText);
    if (!snippetMatch?.[1]) {
      continue;
    }
    const cleaned = stripHtml(decodeHtmlEntities(snippetMatch[1]));
    if (cleaned) {
      return cleaned;
    }
  }

  return '';
}

export {
  buildDuckDuckGoQueryPlans,
  extractSearchSnippetNearAnchor,
  resolveSearchResultUrl,
};
