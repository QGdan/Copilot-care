type HybridRagLexicalMetadataValue = string | number | boolean;

export type HybridRagLexicalMetadata = Record<
  string,
  HybridRagLexicalMetadataValue
>;

export interface HybridRagLexicalDocument {
  id: string;
  text: string;
  metadata?: HybridRagLexicalMetadata;
}

export interface HybridRagLexicalQuery {
  query: string;
  topK: number;
  minScore?: number;
  filter?: Partial<HybridRagLexicalMetadata>;
}

export interface HybridRagLexicalMatch {
  id: string;
  score: number;
  matchedTerms: string[];
  text: string;
  metadata: HybridRagLexicalMetadata;
}

export interface HybridRagLexicalStats {
  documentCount: number;
  vocabularySize: number;
  averageDocumentLength: number;
}

interface StoredLexicalDocument {
  id: string;
  text: string;
  metadata: HybridRagLexicalMetadata;
  tokens: string[];
  termFrequency: Map<string, number>;
}

const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

function tokenize(input: string): string[] {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim();
  if (normalized.length === 0) {
    return [];
  }
  const segments = normalized.split(/\s+/).filter((token) => token.length > 0);
  const cjkCharTokens = normalized.match(/[\u4e00-\u9fff]/g) ?? [];
  return [...segments, ...cjkCharTokens];
}

function buildTermFrequency(tokens: string[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  return frequency;
}

function metadataMatches(
  metadata: HybridRagLexicalMetadata,
  filter: Partial<HybridRagLexicalMetadata> | undefined,
): boolean {
  if (!filter) {
    return true;
  }
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) {
      continue;
    }
    if (metadata[key] !== value) {
      return false;
    }
  }
  return true;
}

function resolveTopK(topK: number): number {
  if (!Number.isFinite(topK)) {
    return 10;
  }
  return Math.max(1, Math.min(1000, Math.floor(topK)));
}

export class Bm25HybridRagLexicalIndex {
  private readonly k1: number;

  private readonly b: number;

  private readonly documents = new Map<string, StoredLexicalDocument>();

  private readonly documentFrequency = new Map<string, number>();

  private averageDocumentLength = 0;

  public constructor(k1: number = DEFAULT_K1, b: number = DEFAULT_B) {
    this.k1 = k1;
    this.b = b;
  }

  private rebuildStats(): void {
    this.documentFrequency.clear();
    let totalTokens = 0;

    for (const document of this.documents.values()) {
      totalTokens += document.tokens.length;
      const uniqueTerms = new Set(document.tokens);
      for (const term of uniqueTerms) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }

    this.averageDocumentLength =
      this.documents.size > 0 ? totalTokens / this.documents.size : 0;
  }

  public upsert(documents: HybridRagLexicalDocument[]): void {
    for (const document of documents) {
      const id = document.id.trim();
      const text = document.text.trim();
      if (!id || !text) {
        continue;
      }
      const tokens = tokenize(text);
      const storedDocument: StoredLexicalDocument = {
        id,
        text,
        metadata: { ...(document.metadata ?? {}) },
        tokens,
        termFrequency: buildTermFrequency(tokens),
      };
      this.documents.set(id, storedDocument);
    }
    this.rebuildStats();
  }

  public remove(ids: string[]): number {
    let removed = 0;
    for (const id of ids) {
      if (this.documents.delete(id)) {
        removed += 1;
      }
    }
    if (removed > 0) {
      this.rebuildStats();
    }
    return removed;
  }

  public search(request: HybridRagLexicalQuery): HybridRagLexicalMatch[] {
    const queryTerms = [...new Set(tokenize(request.query))];
    if (queryTerms.length === 0 || this.documents.size === 0) {
      return [];
    }

    const totalDocuments = this.documents.size;
    const safeAverageLength = this.averageDocumentLength > 0 ? this.averageDocumentLength : 1;
    const minScore = request.minScore ?? 0;
    const matches: HybridRagLexicalMatch[] = [];

    for (const document of this.documents.values()) {
      if (!metadataMatches(document.metadata, request.filter)) {
        continue;
      }
      const docLength = document.tokens.length;
      let score = 0;
      const matchedTerms: string[] = [];

      for (const term of queryTerms) {
        const termFrequency = document.termFrequency.get(term) ?? 0;
        if (termFrequency === 0) {
          continue;
        }
        const documentFrequency = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(
          1 + (totalDocuments - documentFrequency + 0.5) / (documentFrequency + 0.5),
        );
        const denominator =
          termFrequency +
          this.k1 * (1 - this.b + (this.b * docLength) / safeAverageLength);
        const bm25TermScore = idf * ((termFrequency * (this.k1 + 1)) / denominator);
        score += bm25TermScore;
        matchedTerms.push(term);
      }

      const normalizedScore = Number(score.toFixed(6));
      if (normalizedScore < minScore) {
        continue;
      }
      if (matchedTerms.length === 0) {
        continue;
      }
      matches.push({
        id: document.id,
        score: normalizedScore,
        matchedTerms,
        text: document.text,
        metadata: { ...document.metadata },
      });
    }

    matches.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.id.localeCompare(right.id);
    });

    return matches.slice(0, resolveTopK(request.topK));
  }

  public stats(): HybridRagLexicalStats {
    return {
      documentCount: this.documents.size,
      vocabularySize: this.documentFrequency.size,
      averageDocumentLength: Number(this.averageDocumentLength.toFixed(4)),
    };
  }
}

export function createBm25HybridRagLexicalIndex(
  k1?: number,
  b?: number,
): Bm25HybridRagLexicalIndex {
  return new Bm25HybridRagLexicalIndex(k1, b);
}

