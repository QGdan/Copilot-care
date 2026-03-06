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

  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }

  if (href.startsWith('/l/?')) {
    try {
      const target = new URL(`https://duckduckgo.com${href}`);
      const decoded = target.searchParams.get('uddg');
      return decoded ? decodeURIComponent(decoded) : null;
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

  const windowText = html.slice(anchorIndex, Math.min(html.length, anchorIndex + 1400));
  const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i
    .exec(windowText);
  if (!snippetMatch?.[1]) {
    return '';
  }
  return stripHtml(decodeHtmlEntities(snippetMatch[1]));
}

export {
  buildDuckDuckGoQueryPlans,
  extractSearchSnippetNearAnchor,
  resolveSearchResultUrl,
};
