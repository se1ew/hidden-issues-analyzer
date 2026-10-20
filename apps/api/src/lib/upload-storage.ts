import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const UPLOADS_DIR = fileURLToPath(new URL('../../uploads/', import.meta.url));
export function containedUpload(file: string) {
  return path.dirname(path.resolve(file)) === path.resolve(UPLOADS_DIR) && /^csv-[a-f0-9-]+\.tmp$/.test(path.basename(file));
}
