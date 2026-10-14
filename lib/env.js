// Loads .env before any other module reads process.env (must be the first import).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') console.warn('.env okunamadı:', err.message);
}

export const ROOT = root;
