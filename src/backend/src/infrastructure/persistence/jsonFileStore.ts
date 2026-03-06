import fs from 'node:fs';
import path from 'node:path';

function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readJsonFile<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return undefined;
    }
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureParentDirectory(filePath);
  const tempFilePath = `${filePath}.tmp`;
  fs.writeFileSync(tempFilePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempFilePath, filePath);
}
