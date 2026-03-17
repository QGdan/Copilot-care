import {
  HybridRagVectorFilter,
  HybridRagVectorMatch,
  HybridRagVectorMetadata,
  HybridRagVectorNamespaceStats,
  HybridRagVectorQuery,
  HybridRagVectorRecord,
  HybridRagVectorStorePort,
} from '../../../application/ports/HybridRagVectorStorePort';

type InMemoryHybridRagVectorStoreErrorCode =
  | 'INVALID_NAMESPACE'
  | 'INVALID_VECTOR_DIMENSION'
  | 'INVALID_VECTOR_VALUE';

export class InMemoryHybridRagVectorStoreError extends Error {
  public readonly code: InMemoryHybridRagVectorStoreErrorCode;

  public constructor(
    code: InMemoryHybridRagVectorStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InMemoryHybridRagVectorStoreError';
    this.code = code;
  }
}

interface StoredVectorRecord {
  id: string;
  vector: number[];
  normalizedVector: number[];
  text: string;
  metadata: HybridRagVectorMetadata;
  updatedAt: string;
}

interface NamespaceState {
  dimension: number | null;
  updatedAt: string;
  records: Map<string, StoredVectorRecord>;
}

function assertNamespace(namespace: string): string {
  const normalized = namespace.trim();
  if (normalized.length === 0) {
    throw new InMemoryHybridRagVectorStoreError(
      'INVALID_NAMESPACE',
      'namespace must not be empty',
    );
  }
  return normalized;
}

function assertFiniteVector(vector: number[]): void {
  if (vector.length === 0) {
    throw new InMemoryHybridRagVectorStoreError(
      'INVALID_VECTOR_DIMENSION',
      'vector must contain at least one dimension',
    );
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new InMemoryHybridRagVectorStoreError(
        'INVALID_VECTOR_VALUE',
        'vector contains non-finite value',
      );
    }
  }
}

function normalizeVector(vector: number[]): number[] {
  assertFiniteVector(vector);
  const squareSum = vector.reduce((sum, value) => sum + value * value, 0);
  if (squareSum === 0) {
    return vector.map(() => 0);
  }
  const norm = Math.sqrt(squareSum);
  return vector.map((value) => value / norm);
}

function cosineSimilarity(left: number[], right: number[]): number {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return Number(score.toFixed(6));
}

function filterByMetadata(
  metadata: HybridRagVectorMetadata,
  filter: HybridRagVectorFilter | undefined,
): boolean {
  if (!filter?.metadata) {
    return true;
  }
  const expectedEntries = Object.entries(filter.metadata);
  for (const [key, expectedValue] of expectedEntries) {
    if (expectedValue === undefined) {
      continue;
    }
    if (metadata[key] !== expectedValue) {
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

export class InMemoryHybridRagVectorStore implements HybridRagVectorStorePort {
  private readonly namespaces = new Map<string, NamespaceState>();

  private getOrCreateNamespace(namespace: string): NamespaceState {
    const normalizedNamespace = assertNamespace(namespace);
    const existing = this.namespaces.get(normalizedNamespace);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    const created: NamespaceState = {
      dimension: null,
      updatedAt: now,
      records: new Map<string, StoredVectorRecord>(),
    };
    this.namespaces.set(normalizedNamespace, created);
    return created;
  }

  private getNamespace(namespace: string): NamespaceState | null {
    const normalizedNamespace = assertNamespace(namespace);
    return this.namespaces.get(normalizedNamespace) ?? null;
  }

  public async upsert(
    namespace: string,
    records: HybridRagVectorRecord[],
  ): Promise<void> {
    const state = this.getOrCreateNamespace(namespace);
    const now = new Date().toISOString();

    for (const record of records) {
      if (record.id.trim().length === 0) {
        continue;
      }
      assertFiniteVector(record.vector);
      if (state.dimension === null) {
        state.dimension = record.vector.length;
      }
      if (record.vector.length !== state.dimension) {
        throw new InMemoryHybridRagVectorStoreError(
          'INVALID_VECTOR_DIMENSION',
          `vector dimension mismatch, expected=${state.dimension}, got=${record.vector.length}`,
        );
      }
      const clonedVector = [...record.vector];
      state.records.set(record.id, {
        id: record.id,
        vector: clonedVector,
        normalizedVector: normalizeVector(clonedVector),
        text: record.text,
        metadata: { ...record.metadata },
        updatedAt: now,
      });
      state.updatedAt = now;
    }
  }

  public async query(
    namespace: string,
    request: HybridRagVectorQuery,
  ): Promise<HybridRagVectorMatch[]> {
    const state = this.getNamespace(namespace);
    if (!state || state.records.size === 0 || state.dimension === null) {
      return [];
    }
    assertFiniteVector(request.vector);
    if (request.vector.length !== state.dimension) {
      throw new InMemoryHybridRagVectorStoreError(
        'INVALID_VECTOR_DIMENSION',
        `query vector dimension mismatch, expected=${state.dimension}, got=${request.vector.length}`,
      );
    }

    const normalizedQuery = normalizeVector(request.vector);
    const minScore = request.minScore ?? -1;

    const matches: HybridRagVectorMatch[] = [];
    for (const record of state.records.values()) {
      if (!filterByMetadata(record.metadata, request.filter)) {
        continue;
      }
      const score = cosineSimilarity(normalizedQuery, record.normalizedVector);
      if (score < minScore) {
        continue;
      }
      matches.push({
        id: record.id,
        score,
        text: record.text,
        metadata: { ...record.metadata },
        vector: request.includeVector ? [...record.vector] : undefined,
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

  public async delete(namespace: string, ids: string[]): Promise<number> {
    const state = this.getNamespace(namespace);
    if (!state) {
      return 0;
    }
    let removed = 0;
    for (const id of ids) {
      if (state.records.delete(id)) {
        removed += 1;
      }
    }
    if (removed > 0) {
      state.updatedAt = new Date().toISOString();
    }
    return removed;
  }

  public async stats(namespace: string): Promise<HybridRagVectorNamespaceStats> {
    const normalizedNamespace = assertNamespace(namespace);
    const state = this.namespaces.get(normalizedNamespace);
    if (!state) {
      return {
        namespace: normalizedNamespace,
        dimension: null,
        recordCount: 0,
        updatedAt: new Date(0).toISOString(),
      };
    }
    return {
      namespace: normalizedNamespace,
      dimension: state.dimension,
      recordCount: state.records.size,
      updatedAt: state.updatedAt,
    };
  }
}

export function createInMemoryHybridRagVectorStore(): InMemoryHybridRagVectorStore {
  return new InMemoryHybridRagVectorStore();
}

