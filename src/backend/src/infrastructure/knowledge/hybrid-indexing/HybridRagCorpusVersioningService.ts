import { createHash } from 'crypto';

import {
  HybridRagCorpusDiffResult,
  HybridRagCorpusSnapshot,
  HybridRagIngestionResult,
} from './types';

const VERSION_PREFIX = 'hybrid-rag';
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export interface BuildHybridRagCorpusSnapshotInput {
  ingestion: HybridRagIngestionResult;
  generatedAt?: string;
}

function hashValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeGeneratedAt(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return new Date().toISOString();
  }
  if (ISO_8601_PATTERN.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function toVersionTimestamp(isoTime: string): string {
  const compacted = isoTime.replace(/[^0-9]/g, '');
  if (compacted.length >= 14) {
    return compacted.slice(0, 14);
  }
  return compacted.padEnd(14, '0');
}

function buildSourceBreakdown(
  ingestion: HybridRagIngestionResult,
): Array<{ sourceId: string; count: number }> {
  const counter = new Map<string, number>();
  for (const chunk of ingestion.chunks) {
    const currentCount = counter.get(chunk.metadata.sourceId) ?? 0;
    counter.set(chunk.metadata.sourceId, currentCount + 1);
  }
  return [...counter.entries()]
    .map(([sourceId, count]) => ({
      sourceId,
      count,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.sourceId.localeCompare(right.sourceId);
    });
}

function inferDocumentCount(ingestion: HybridRagIngestionResult): number {
  if (ingestion.normalizedDocuments.length > 0) {
    return ingestion.normalizedDocuments.length;
  }
  const uniqueDocumentKeys = new Set<string>();
  for (const chunk of ingestion.chunks) {
    uniqueDocumentKeys.add(`${chunk.metadata.sourceId}|${chunk.metadata.url}`);
  }
  return uniqueDocumentKeys.size;
}

function buildFingerprint(ingestion: HybridRagIngestionResult): string {
  const documentFingerprints =
    ingestion.normalizedDocuments.length > 0
      ? ingestion.normalizedDocuments.map((document) =>
          [
            document.documentId,
            document.sourceId,
            document.url,
            document.contentHash,
            document.publishedOn ?? '',
          ].join('|'),
        )
      : [];
  const chunkFingerprints = ingestion.chunks.map((chunk) =>
    [
      chunk.chunkId,
      chunk.metadata.sourceId,
      chunk.metadata.url,
      chunk.metadata.chunkIndex,
      hashValue(chunk.text),
    ].join('|'),
  );

  const payload = JSON.stringify({
    documentCount: inferDocumentCount(ingestion),
    chunkCount: ingestion.chunkCount,
    documentFingerprints: [...documentFingerprints].sort(),
    chunkFingerprints: [...chunkFingerprints].sort(),
  });

  return hashValue(payload);
}

function hasSourceBreakdownChanged(
  previous: HybridRagCorpusSnapshot,
  current: HybridRagCorpusSnapshot,
): boolean {
  if (previous.sourceBreakdown.length !== current.sourceBreakdown.length) {
    return true;
  }
  for (let index = 0; index < previous.sourceBreakdown.length; index += 1) {
    const left = previous.sourceBreakdown[index];
    const right = current.sourceBreakdown[index];
    if (!left || !right) {
      return true;
    }
    if (left.sourceId !== right.sourceId || left.count !== right.count) {
      return true;
    }
  }
  return false;
}

export class HybridRagCorpusVersioningService {
  public buildSnapshot(
    input: BuildHybridRagCorpusSnapshotInput,
  ): HybridRagCorpusSnapshot {
    const generatedAt = normalizeGeneratedAt(input.generatedAt);
    const documentCount = inferDocumentCount(input.ingestion);
    const sourceBreakdown = buildSourceBreakdown(input.ingestion);
    const fingerprint = buildFingerprint(input.ingestion);
    const versionId = `${VERSION_PREFIX}-${toVersionTimestamp(generatedAt)}-${fingerprint.slice(0, 12)}`;

    return {
      versionId,
      generatedAt,
      documentCount,
      chunkCount: input.ingestion.chunkCount,
      sourceBreakdown,
      fingerprint,
    };
  }

  public diffSnapshots(
    previous: HybridRagCorpusSnapshot,
    current: HybridRagCorpusSnapshot,
  ): HybridRagCorpusDiffResult {
    const reasons: string[] = [];
    const changed = previous.fingerprint !== current.fingerprint;

    if (!changed) {
      return {
        changed: false,
        previousVersionId: previous.versionId,
        currentVersionId: current.versionId,
        reasons,
      };
    }

    reasons.push('fingerprint_changed');
    if (previous.documentCount !== current.documentCount) {
      reasons.push('document_count_changed');
    }
    if (previous.chunkCount !== current.chunkCount) {
      reasons.push('chunk_count_changed');
    }
    if (hasSourceBreakdownChanged(previous, current)) {
      reasons.push('source_breakdown_changed');
    }

    return {
      changed: true,
      previousVersionId: previous.versionId,
      currentVersionId: current.versionId,
      reasons,
    };
  }
}

export function createHybridRagCorpusVersioningService(): HybridRagCorpusVersioningService {
  return new HybridRagCorpusVersioningService();
}

