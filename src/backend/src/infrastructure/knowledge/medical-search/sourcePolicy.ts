import {
  AuthoritativeMedicalEvidence,
  AuthoritativeMedicalSearchQuery,
  AuthoritativeMedicalSource,
  resolveSourceByUrl,
} from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import {
  PUBMED_SOURCE_ID,
  SEARCH_STRATEGY_VERSION,
  SearchSourceScope,
  SOURCE_PRIORITY_ORDER,
} from './types';

function normalizeSourceId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSourceIdList(
  values: readonly string[] | undefined,
  sourceById: ReadonlyMap<string, AuthoritativeMedicalSource>,
): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const normalized: string[] = [];
  const dedup = new Set<string>();

  for (const value of values) {
    const sourceId = normalizeSourceId(value);
    if (!sourceId || !sourceById.has(sourceId) || dedup.has(sourceId)) {
      continue;
    }
    dedup.add(sourceId);
    normalized.push(sourceId);
  }

  return normalized;
}

function resolveSearchSourceScope(
  sources: AuthoritativeMedicalSource[],
  input: AuthoritativeMedicalSearchQuery,
): SearchSourceScope {
  const sourceById = new Map<string, AuthoritativeMedicalSource>(
    sources.map((source) => [source.id, source]),
  );
  const sourceFilterIds = normalizeSourceIdList(input.sourceFilter, sourceById);
  const requiredSourceIdsRaw = normalizeSourceIdList(
    input.requiredSources,
    sourceById,
  );
  const allowedSources =
    sourceFilterIds.length > 0
      ? sourceFilterIds
        .map((sourceId) => sourceById.get(sourceId))
        .filter(
          (source): source is AuthoritativeMedicalSource => source !== undefined,
        )
      : [...sources];
  const allowedSourceIds = new Set(allowedSources.map((source) => source.id));
  const requiredSourceIds = requiredSourceIdsRaw.filter((sourceId) =>
    allowedSourceIds.has(sourceId),
  );

  return {
    sourceById,
    allowedSources,
    allowedSourceIds,
    requiredSourceIds,
  };
}

function resolveEvidenceSourceId(
  item: AuthoritativeMedicalEvidence,
  sourceById: ReadonlyMap<string, AuthoritativeMedicalSource>,
): string | null {
  const explicitSourceId = normalizeSourceId(item.sourceId);
  if (explicitSourceId && sourceById.has(explicitSourceId)) {
    return explicitSourceId;
  }

  const sourceByUrl = resolveSourceByUrl(item.url);
  return sourceByUrl?.id ?? null;
}

function sourcePriority(sourceId: string): number {
  const index = SOURCE_PRIORITY_ORDER.indexOf(
    sourceId as (typeof SOURCE_PRIORITY_ORDER)[number],
  );
  return index >= 0 ? index : SOURCE_PRIORITY_ORDER.length + 1;
}

function compareSourceOrder(left: string, right: string): number {
  const leftPriority = sourcePriority(left);
  const rightPriority = sourcePriority(right);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.localeCompare(right);
}

function buildSourceBreakdown(
  items: AuthoritativeMedicalEvidence[],
): Array<{ sourceId: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const sourceId = item.sourceId || 'UNKNOWN';
    counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([sourceId, count]) => ({
      sourceId,
      count,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return compareSourceOrder(left.sourceId, right.sourceId);
    });
}

function normalizeSemanticText(value: string): string {
  return value
    .toLowerCase()
    .replace(/source\s*:\s*[^\.\n]+/gi, ' ')
    .replace(/title\s*:\s*/gi, ' ')
    .replace(/snippet\s*:\s*/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSemanticText(value: string): string[] {
  return normalizeSemanticText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .slice(0, 64);
}

function jaccardSimilarity(
  leftTokens: readonly string[],
  rightTokens: readonly string[],
): number {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...left, ...right]).size;
  return union > 0 ? intersection / union : 0;
}

function buildEvidenceSemanticSignature(
  item: AuthoritativeMedicalEvidence,
): { normalized: string; tokens: string[] } {
  const normalized = normalizeSemanticText(`${item.title} ${item.snippet}`);
  return {
    normalized,
    tokens: tokenizeSemanticText(normalized),
  };
}

function calculateEvidenceSimilarity(
  left: AuthoritativeMedicalEvidence,
  right: AuthoritativeMedicalEvidence,
  signatureCache: Map<string, { normalized: string; tokens: string[] }>,
): number {
  const leftKey = left.url.toLowerCase();
  const rightKey = right.url.toLowerCase();
  const leftSig =
    signatureCache.get(leftKey) ?? buildEvidenceSemanticSignature(left);
  const rightSig =
    signatureCache.get(rightKey) ?? buildEvidenceSemanticSignature(right);
  signatureCache.set(leftKey, leftSig);
  signatureCache.set(rightKey, rightSig);

  if (
    leftSig.normalized &&
    rightSig.normalized &&
    (
      leftSig.normalized === rightSig.normalized ||
      (leftSig.normalized.length >= 36 &&
        rightSig.normalized.includes(leftSig.normalized)) ||
      (rightSig.normalized.length >= 36 &&
        leftSig.normalized.includes(rightSig.normalized))
    )
  ) {
    return 1;
  }

  const tokenSimilarity = jaccardSimilarity(leftSig.tokens, rightSig.tokens);
  return tokenSimilarity;
}

function pickMostDiverseCandidate(input: {
  queue: AuthoritativeMedicalEvidence[];
  selected: AuthoritativeMedicalEvidence[];
  signatureCache: Map<string, { normalized: string; tokens: string[] }>;
}): AuthoritativeMedicalEvidence | null {
  const { queue, selected, signatureCache } = input;
  if (queue.length === 0) {
    return null;
  }
  if (selected.length === 0) {
    return queue.shift() ?? null;
  }

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
    let maxSimilarity = 0;
    for (const existing of selected) {
      const similarity = calculateEvidenceSimilarity(
        candidate,
        existing,
        signatureCache,
      );
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
    }
    const queryTokenBonus = Math.min(
      0.8,
      (candidate.matchedQueryTokens?.length ?? 0) * 0.2,
    );
    const noTokenPenalty =
      (candidate.matchedQueryTokens?.length ?? 0) === 0 ? 0.5 : 0;
    const score = (1 - maxSimilarity) + queryTokenBonus - noTokenPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  const [picked] = queue.splice(bestIndex, 1);
  return picked ?? null;
}

function selectDiverseEvidence(
  candidates: AuthoritativeMedicalEvidence[],
  limit: number,
): AuthoritativeMedicalEvidence[] {
  if (limit <= 0 || candidates.length === 0) {
    return [];
  }

  const queues = new Map<string, AuthoritativeMedicalEvidence[]>();
  for (const item of candidates) {
    const sourceId = item.sourceId || 'UNKNOWN';
    const bucket = queues.get(sourceId) ?? [];
    bucket.push(item);
    queues.set(sourceId, bucket);
  }

  const sourceOrder = [...queues.keys()].sort(compareSourceOrder);
  const selected: AuthoritativeMedicalEvidence[] = [];
  const selectedCountBySource = new Map<string, number>();
  const signatureCache = new Map<string, { normalized: string; tokens: string[] }>();
  const pubMedMaxShare = Math.max(1, Math.ceil(limit * 0.5));
  const firstPubMedCandidate = candidates.find(
    (item) => item.sourceId === PUBMED_SOURCE_ID,
  );

  let progress = true;
  while (selected.length < limit && progress) {
    progress = false;
    for (const sourceId of sourceOrder) {
      const queue = queues.get(sourceId);
      if (!queue || queue.length === 0) {
        continue;
      }
      const selectedCount = selectedCountBySource.get(sourceId) ?? 0;
      if (sourceId === PUBMED_SOURCE_ID && selectedCount >= pubMedMaxShare) {
        continue;
      }
      const next = pickMostDiverseCandidate({
        queue,
        selected,
        signatureCache,
      });
      if (!next) {
        continue;
      }
      selected.push(next);
      selectedCountBySource.set(sourceId, selectedCount + 1);
      progress = true;
      if (selected.length >= limit) {
        break;
      }
    }
  }

  if (selected.length < limit) {
    for (const sourceId of sourceOrder) {
      const queue = queues.get(sourceId);
      if (!queue || queue.length === 0) {
        continue;
      }
      while (queue.length > 0 && selected.length < limit) {
        const next = pickMostDiverseCandidate({
          queue,
          selected,
          signatureCache,
        });
        if (!next) {
          break;
        }
        selected.push(next);
      }
      if (selected.length >= limit) {
        break;
      }
    }
  }

  if (
    limit >= 3 &&
    firstPubMedCandidate &&
    !selected.some((item) => item.sourceId === PUBMED_SOURCE_ID)
  ) {
    if (selected.length < limit) {
      selected.push(firstPubMedCandidate);
      return selected.slice(0, limit);
    }
    // Keep one literature slot to avoid flipping into guideline-only bias.
    selected[selected.length - 1] = firstPubMedCandidate;
  }

  return selected;
}

function enforceRequiredSourceCoverage(
  selected: AuthoritativeMedicalEvidence[],
  candidates: AuthoritativeMedicalEvidence[],
  requiredSourceIds: readonly string[],
  limit: number,
): AuthoritativeMedicalEvidence[] {
  if (requiredSourceIds.length === 0 || limit <= 0) {
    return selected.slice(0, limit);
  }

  const requiredSet = new Set(requiredSourceIds);
  const result = selected.slice(0, limit);
  const presentRequired = new Set(
    result
      .map((item) => item.sourceId)
      .filter((sourceId) => requiredSet.has(sourceId)),
  );
  const usedUrls = new Set(result.map((item) => item.url.toLowerCase()));

  const firstCandidateByRequiredSource = new Map<
    string,
    AuthoritativeMedicalEvidence
  >();
  for (const candidate of candidates) {
    if (
      requiredSet.has(candidate.sourceId) &&
      !firstCandidateByRequiredSource.has(candidate.sourceId)
    ) {
      firstCandidateByRequiredSource.set(candidate.sourceId, candidate);
    }
  }

  for (const sourceId of requiredSourceIds) {
    if (presentRequired.has(sourceId)) {
      continue;
    }
    const candidate = firstCandidateByRequiredSource.get(sourceId);
    if (!candidate) {
      continue;
    }
    const candidateUrlKey = candidate.url.toLowerCase();
    if (usedUrls.has(candidateUrlKey)) {
      presentRequired.add(sourceId);
      continue;
    }

    if (result.length < limit) {
      result.push(candidate);
      usedUrls.add(candidateUrlKey);
      presentRequired.add(sourceId);
      continue;
    }

    let replaceIndex = -1;
    for (let index = result.length - 1; index >= 0; index -= 1) {
      if (!requiredSet.has(result[index].sourceId)) {
        replaceIndex = index;
        break;
      }
    }
    if (replaceIndex < 0) {
      continue;
    }
    const replacedUrlKey = result[replaceIndex].url.toLowerCase();
    result[replaceIndex] = candidate;
    usedUrls.delete(replacedUrlKey);
    usedUrls.add(candidateUrlKey);
    presentRequired.add(sourceId);
  }

  return result.slice(0, limit);
}

function createEmptySearchResultShape(query: string): {
  query: string;
  results: [];
  droppedByPolicy: 0;
  usedSources: [];
  sourceBreakdown: [];
  strategyVersion: string;
  generatedAt: string;
  realtimeCount: 0;
  fallbackCount: 0;
  fallbackReasons: [];
  missingRequiredSources: [];
} {
  return {
    query,
    results: [],
    droppedByPolicy: 0,
    usedSources: [],
    sourceBreakdown: [],
    strategyVersion: SEARCH_STRATEGY_VERSION,
    generatedAt: new Date().toISOString(),
    realtimeCount: 0,
    fallbackCount: 0,
    fallbackReasons: [],
    missingRequiredSources: [],
  };
}

export {
  buildSourceBreakdown,
  compareSourceOrder,
  createEmptySearchResultShape,
  enforceRequiredSourceCoverage,
  resolveEvidenceSourceId,
  resolveSearchSourceScope,
  selectDiverseEvidence,
};
