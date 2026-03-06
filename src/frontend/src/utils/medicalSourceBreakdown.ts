export interface MedicalSourceBreakdownItem {
  sourceId: string;
  count: number;
}

export interface MedicalSourceBreakdown {
  items: MedicalSourceBreakdownItem[];
  strategyVersion: string;
}

const BREAKDOWN_PATTERN = /权威医学来源分布：(.+?)（策略：([^)）]+)）/u;
const SOURCE_COUNT_PATTERN = /^([A-Za-z0-9_-]+)\s*x\s*(\d+)$/;

function parseSourceItem(token: string): MedicalSourceBreakdownItem | null {
  const match = SOURCE_COUNT_PATTERN.exec(token.trim());
  if (!match) {
    return null;
  }

  const count = Number(match[2]);
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }

  return {
    sourceId: match[1],
    count,
  };
}

export function parseMedicalSourceBreakdownMessage(
  message: string,
): MedicalSourceBreakdown | null {
  const normalized = message.trim();
  if (!normalized) {
    return null;
  }

  const match = BREAKDOWN_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }

  const sourceListText = match[1]?.trim() ?? '';
  const strategyVersion = match[2]?.trim() ?? '';
  if (!sourceListText || !strategyVersion) {
    return null;
  }

  const items = sourceListText
    .split(/[，,]/)
    .map((token) => parseSourceItem(token))
    .filter((item): item is MedicalSourceBreakdownItem => Boolean(item));

  if (items.length === 0) {
    return null;
  }

  return {
    items,
    strategyVersion,
  };
}
