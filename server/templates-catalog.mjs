// Loads the shipped template library (read-only reference data) once per process and fingerprints the file.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'templates');
let cached = null;
export function loadTemplateCatalog(file = path.join(dir, '200_PROJECT_TEMPLATES.json')) {
  if (file === path.join(dir, '200_PROJECT_TEMPLATES.json') && cached) return cached;
  const raw = fs.readFileSync(file);
  const cat = JSON.parse(raw.toString('utf8'));
  cat.hash = crypto.createHash('sha256').update(raw).digest('hex');
  if (file.endsWith('200_PROJECT_TEMPLATES.json') && file.startsWith(dir)) cached = cat;
  return cat;
}
