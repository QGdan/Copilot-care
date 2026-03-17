export interface HybridRagEmbeddingRequest {
  texts: string[];
  dimensions?: number;
}

export interface HybridRagEmbeddingResponse {
  model: string;
  dimensions: number;
  vectors: number[][];
}

export interface HybridRagEmbeddingPort {
  embed(input: HybridRagEmbeddingRequest): Promise<HybridRagEmbeddingResponse>;
}

