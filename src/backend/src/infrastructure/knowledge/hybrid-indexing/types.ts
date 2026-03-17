export interface HybridRagRawDocument {
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  content: string;
  publishedOn?: string;
  tags?: string[];
  fetchedAt?: string;
}

export interface HybridRagNormalizedDocument {
  documentId: string;
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  content: string;
  contentHash: string;
  publishedOn?: string;
  tags: string[];
  fetchedAt: string;
}

export interface HybridRagChunkMetadata {
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  publishedOn?: string;
  tags: string[];
  riskTags: string[];
  clinicalDomains: string[];
  chunkIndex: number;
  totalChunks: number;
}

export interface HybridRagChunk {
  chunkId: string;
  text: string;
  tokenEstimate: number;
  metadata: HybridRagChunkMetadata;
}

export interface HybridRagIngestionOptions {
  chunkCharSize?: number;
  chunkCharOverlap?: number;
  minChunkChars?: number;
}

export interface HybridRagIngestionResult {
  documentCount: number;
  normalizedDocumentCount: number;
  chunkCount: number;
  normalizedDocuments: HybridRagNormalizedDocument[];
  chunks: HybridRagChunk[];
}

export interface HybridRagCorpusSnapshot {
  versionId: string;
  generatedAt: string;
  documentCount: number;
  chunkCount: number;
  sourceBreakdown: Array<{
    sourceId: string;
    count: number;
  }>;
  fingerprint: string;
}

export interface HybridRagCorpusDiffResult {
  changed: boolean;
  previousVersionId: string;
  currentVersionId: string;
  reasons: string[];
}
