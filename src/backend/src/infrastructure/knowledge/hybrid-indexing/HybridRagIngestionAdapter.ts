import { createHash } from 'crypto';

import {
  HybridRagChunk,
  HybridRagIngestionOptions,
  HybridRagIngestionResult,
  HybridRagNormalizedDocument,
  HybridRagRawDocument,
} from './types';

const DEFAULT_CHUNK_CHAR_SIZE = 900;
const DEFAULT_CHUNK_CHAR_OVERLAP = 120;
const DEFAULT_MIN_CHUNK_CHARS = 120;
const MAX_CHUNK_CHAR_SIZE = 4000;
const CHUNK_BREAK_WINDOW = 120;
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

interface ResolvedIngestionOptions {
  chunkCharSize: number;
  chunkCharOverlap: number;
  minChunkChars: number;
}

const RISK_KEYWORDS: ReadonlyArray<{ tag: string; keywords: readonly string[] }> =
  [
    {
      tag: 'red_flag',
      keywords: ['warning sign', 'red flag', 'urgent', 'emergency', 'same-day'],
    },
    {
      tag: 'cardio_acute',
      keywords: ['chest pain', 'myocardial', 'acute coronary', 'heart attack'],
    },
    {
      tag: 'neuro_acute',
      keywords: ['stroke', 'fast', 'aphasia', 'hemiplegia', 'seizure'],
    },
    {
      tag: 'metabolic_critical',
      keywords: ['ketoacidosis', 'hypoglycemia', 'hyperglycemia crisis'],
    },
  ];

const DOMAIN_KEYWORDS: ReadonlyArray<{
  domain: string;
  keywords: readonly string[];
}> = [
  {
    domain: 'hypertension',
    keywords: ['hypertension', 'blood pressure', 'systolic', 'diastolic'],
  },
  {
    domain: 'diabetes',
    keywords: ['diabetes', 'hba1c', 'glucose', 'insulin'],
  },
  {
    domain: 'cardiovascular',
    keywords: ['cardiovascular', 'heart', 'lipid', 'stroke'],
  },
  {
    domain: 'public-health',
    keywords: ['screening', 'prevention', 'population', 'public health'],
  },
];

function hashValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toLowerBag(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeTags(tags: string[] | undefined): string[] {
  const unique = new Set<string>();
  for (const tag of tags ?? []) {
    const normalized = tag.trim().toLowerCase();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return [...unique].sort();
}

function normalizeDate(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  if (ISO_8601_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString();
}

function canonicalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    const target = new URL(trimmed);
    target.protocol = target.protocol.toLowerCase();
    target.hostname = target.hostname.toLowerCase();
    target.hash = '';
    if (target.pathname.length > 1) {
      target.pathname = target.pathname.replace(/\/+$/, '');
    }
    const entries = [...target.searchParams.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    target.search = '';
    for (const [key, value] of entries) {
      target.searchParams.append(key, value);
    }
    return target.toString();
  } catch {
    return trimmed;
  }
}

function extractTagsByKeywords(
  text: string,
  definitions: ReadonlyArray<{ tag?: string; domain?: string; keywords: readonly string[] }>,
  valueSelector: (input: { tag?: string; domain?: string }) => string,
): string[] {
  const bag = toLowerBag(text);
  const collected = new Set<string>();
  for (const definition of definitions) {
    const matched = definition.keywords.some((keyword) =>
      bag.includes(keyword.toLowerCase()),
    );
    if (matched) {
      collected.add(valueSelector(definition));
    }
  }
  return [...collected].sort();
}

function extractRiskTags(text: string): string[] {
  return extractTagsByKeywords(text, RISK_KEYWORDS, (item) => item.tag ?? '');
}

function extractClinicalDomains(text: string): string[] {
  return extractTagsByKeywords(
    text,
    DOMAIN_KEYWORDS,
    (item) => item.domain ?? '',
  );
}

function resolveIngestionOptions(
  options: HybridRagIngestionOptions | undefined,
): ResolvedIngestionOptions {
  const desiredChunkSize = Number.isFinite(options?.chunkCharSize)
    ? Number(options?.chunkCharSize)
    : DEFAULT_CHUNK_CHAR_SIZE;
  const chunkCharSize = Math.max(
    DEFAULT_MIN_CHUNK_CHARS,
    Math.min(MAX_CHUNK_CHAR_SIZE, Math.floor(desiredChunkSize)),
  );

  const desiredOverlap = Number.isFinite(options?.chunkCharOverlap)
    ? Number(options?.chunkCharOverlap)
    : DEFAULT_CHUNK_CHAR_OVERLAP;
  const safeOverlapUpperBound = Math.max(0, chunkCharSize - 20);
  const chunkCharOverlap = Math.max(
    0,
    Math.min(safeOverlapUpperBound, Math.floor(desiredOverlap)),
  );

  const desiredMinChunk = Number.isFinite(options?.minChunkChars)
    ? Number(options?.minChunkChars)
    : DEFAULT_MIN_CHUNK_CHARS;
  const minChunkChars = Math.max(
    20,
    Math.min(chunkCharSize, Math.floor(desiredMinChunk)),
  );

  return {
    chunkCharSize,
    chunkCharOverlap,
    minChunkChars,
  };
}

function pickBreakPoint(
  text: string,
  start: number,
  hardEnd: number,
  minChunkChars: number,
): number {
  const minimumEnd = Math.min(text.length, start + minChunkChars);
  if (hardEnd <= minimumEnd) {
    return hardEnd;
  }

  const backwardWindowStart = Math.max(minimumEnd, hardEnd - CHUNK_BREAK_WINDOW);
  for (let index = hardEnd; index >= backwardWindowStart; index -= 1) {
    const char = text[index];
    if (char === '\n' || char === '.' || char === '!' || char === '?' || char === ';') {
      return index + 1;
    }
  }

  const forwardWindowEnd = Math.min(text.length, hardEnd + CHUNK_BREAK_WINDOW);
  for (let index = hardEnd; index <= forwardWindowEnd; index += 1) {
    const char = text[index];
    if (char === '\n' || char === '.' || char === '!' || char === '?' || char === ';') {
      return index + 1;
    }
  }

  return hardEnd;
}

function toTokenEstimate(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function parseTime(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function shouldReplaceDocument(
  existing: HybridRagNormalizedDocument,
  candidate: HybridRagNormalizedDocument,
): boolean {
  const existingTime = parseTime(existing.fetchedAt);
  const candidateTime = parseTime(candidate.fetchedAt);
  if (candidateTime > existingTime) {
    return true;
  }
  if (candidateTime < existingTime) {
    return false;
  }
  return candidate.content.length > existing.content.length;
}

function buildNormalizedDocument(
  rawDocument: HybridRagRawDocument,
  nowIso: string,
): HybridRagNormalizedDocument | null {
  const sourceId = rawDocument.sourceId.trim();
  const sourceName = rawDocument.sourceName.trim();
  const title = rawDocument.title.trim();
  const canonicalUrl = canonicalizeUrl(rawDocument.url);
  const content = normalizeWhitespace(rawDocument.content);

  if (!sourceId || !sourceName || !title || !canonicalUrl || !content) {
    return null;
  }

  const fetchedAt = normalizeDate(rawDocument.fetchedAt, nowIso);
  const tags = normalizeTags(rawDocument.tags);
  const contentHash = hashValue(content);
  const documentId = hashValue(
    `${sourceId.toLowerCase()}|${canonicalUrl.toLowerCase()}|${title.toLowerCase()}`,
  );

  return {
    documentId,
    sourceId,
    sourceName,
    url: canonicalUrl,
    title,
    content,
    contentHash,
    publishedOn: rawDocument.publishedOn?.trim(),
    tags,
    fetchedAt,
  };
}

function splitIntoChunkTexts(
  content: string,
  options: ResolvedIngestionOptions,
): string[] {
  if (content.length <= options.chunkCharSize) {
    if (content.length >= options.minChunkChars || content.length > 0) {
      return [content];
    }
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const hardEnd = Math.min(content.length, cursor + options.chunkCharSize);
    const preferredEnd = pickBreakPoint(
      content,
      cursor,
      hardEnd,
      options.minChunkChars,
    );
    const safeEnd = Math.max(cursor + 1, preferredEnd);
    const chunkText = normalizeWhitespace(content.slice(cursor, safeEnd));
    if (chunkText.length > 0) {
      if (chunkText.length >= options.minChunkChars || safeEnd >= content.length) {
        chunks.push(chunkText);
      }
    }

    if (safeEnd >= content.length) {
      break;
    }

    const steppedCursor = Math.max(cursor + 1, safeEnd - options.chunkCharOverlap);
    cursor = steppedCursor;
  }

  return chunks;
}

function toChunks(
  document: HybridRagNormalizedDocument,
  options: ResolvedIngestionOptions,
): HybridRagChunk[] {
  const chunkTexts = splitIntoChunkTexts(document.content, options);
  const totalChunks = chunkTexts.length;
  const chunks: HybridRagChunk[] = [];

  for (let index = 0; index < chunkTexts.length; index += 1) {
    const text = chunkTexts[index];
    const bag = `${document.title}\n${text}`;
    const chunkId = hashValue(`${document.documentId}|${index + 1}|${text}`);
    chunks.push({
      chunkId,
      text,
      tokenEstimate: toTokenEstimate(text),
      metadata: {
        sourceId: document.sourceId,
        sourceName: document.sourceName,
        url: document.url,
        title: document.title,
        publishedOn: document.publishedOn,
        tags: document.tags,
        riskTags: extractRiskTags(bag),
        clinicalDomains: extractClinicalDomains(bag),
        chunkIndex: index + 1,
        totalChunks,
      },
    });
  }

  return chunks;
}

export class HybridRagIngestionAdapter {
  private readonly options: ResolvedIngestionOptions;

  public constructor(options?: HybridRagIngestionOptions) {
    this.options = resolveIngestionOptions(options);
  }

  public ingest(documents: HybridRagRawDocument[]): HybridRagIngestionResult {
    const nowIso = new Date().toISOString();
    const deduplicated = new Map<string, HybridRagNormalizedDocument>();

    for (const rawDocument of documents) {
      const normalizedDocument = buildNormalizedDocument(rawDocument, nowIso);
      if (!normalizedDocument) {
        continue;
      }
      const dedupeKey = `${normalizedDocument.sourceId.toLowerCase()}|${normalizedDocument.url.toLowerCase()}`;
      const existing = deduplicated.get(dedupeKey);
      if (!existing || shouldReplaceDocument(existing, normalizedDocument)) {
        deduplicated.set(dedupeKey, normalizedDocument);
      }
    }

    const normalizedDocuments = [...deduplicated.values()].sort((left, right) =>
      `${left.sourceId}|${left.url}`.localeCompare(`${right.sourceId}|${right.url}`),
    );

    const chunks: HybridRagChunk[] = normalizedDocuments.flatMap((document) =>
      toChunks(document, this.options),
    );

    return {
      documentCount: documents.length,
      normalizedDocumentCount: normalizedDocuments.length,
      chunkCount: chunks.length,
      normalizedDocuments,
      chunks,
    };
  }
}

export function createHybridRagIngestionAdapter(
  options?: HybridRagIngestionOptions,
): HybridRagIngestionAdapter {
  return new HybridRagIngestionAdapter(options);
}

