import {
  HybridRagEmbeddingPort,
  HybridRagEmbeddingRequest,
  HybridRagEmbeddingResponse,
} from '../../../application/ports/HybridRagEmbeddingPort';

const DEFAULT_DIMENSIONS = 128;
const MAX_DIMENSIONS = 2048;
const MODEL_NAME = 'deterministic-hash-embedding-v1';

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (normalized.length === 0) {
    return ['__empty__'];
  }
  const tokens = normalized
    .split(/\s+/)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return ['__empty__'];
  }
  return tokens;
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeVector(vector: number[]): number[] {
  const squareSum = vector.reduce((sum, value) => sum + value * value, 0);
  if (squareSum === 0) {
    return vector.map(() => 0);
  }
  const norm = Math.sqrt(squareSum);
  return vector.map((value) => Number((value / norm).toFixed(8)));
}

function resolveDimensions(requested?: number): number {
  if (!Number.isFinite(requested)) {
    return DEFAULT_DIMENSIONS;
  }
  return Math.max(8, Math.min(MAX_DIMENSIONS, Math.floor(Number(requested))));
}

function embedSingleText(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex] ?? '';
    const tokenHash = stableHash(`${token}|${tokenIndex}`);
    const positiveIndex = tokenHash % dimensions;
    const negativeIndex = (tokenHash >>> 8) % dimensions;
    const weight = 1 / Math.sqrt(tokenIndex + 1);
    vector[positiveIndex] = (vector[positiveIndex] ?? 0) + weight;
    vector[negativeIndex] = (vector[negativeIndex] ?? 0) - weight * 0.5;
  }

  return normalizeVector(vector);
}

export class DeterministicHybridRagEmbeddingService
  implements HybridRagEmbeddingPort
{
  private readonly defaultDimensions: number;

  public constructor(defaultDimensions: number = DEFAULT_DIMENSIONS) {
    this.defaultDimensions = resolveDimensions(defaultDimensions);
  }

  public async embed(
    input: HybridRagEmbeddingRequest,
  ): Promise<HybridRagEmbeddingResponse> {
    const dimensions = resolveDimensions(input.dimensions ?? this.defaultDimensions);
    const vectors = input.texts.map((text) => embedSingleText(text, dimensions));
    return {
      model: MODEL_NAME,
      dimensions,
      vectors,
    };
  }
}

export function createDeterministicHybridRagEmbeddingService(
  defaultDimensions?: number,
): DeterministicHybridRagEmbeddingService {
  return new DeterministicHybridRagEmbeddingService(defaultDimensions);
}

