export type HybridRagVectorMetadataValue = string | number | boolean;

export type HybridRagVectorMetadata = Record<
  string,
  HybridRagVectorMetadataValue
>;

export interface HybridRagVectorRecord {
  id: string;
  vector: number[];
  text: string;
  metadata: HybridRagVectorMetadata;
}

export interface HybridRagVectorFilter {
  metadata: Partial<HybridRagVectorMetadata>;
}

export interface HybridRagVectorQuery {
  vector: number[];
  topK: number;
  minScore?: number;
  includeVector?: boolean;
  filter?: HybridRagVectorFilter;
}

export interface HybridRagVectorMatch {
  id: string;
  score: number;
  text: string;
  metadata: HybridRagVectorMetadata;
  vector?: number[];
}

export interface HybridRagVectorNamespaceStats {
  namespace: string;
  dimension: number | null;
  recordCount: number;
  updatedAt: string;
}

export interface HybridRagVectorStorePort {
  upsert(namespace: string, records: HybridRagVectorRecord[]): Promise<void>;
  query(
    namespace: string,
    request: HybridRagVectorQuery,
  ): Promise<HybridRagVectorMatch[]>;
  delete(namespace: string, ids: string[]): Promise<number>;
  stats(namespace: string): Promise<HybridRagVectorNamespaceStats>;
}

