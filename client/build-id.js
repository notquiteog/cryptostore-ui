import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// App and edge images build independently. A timestamp gives identical source
// different release IDs, so the worker can never install against the app HTML.
export function createBuildId(root, env = {}) {
  const hash = createHash('sha256');
  const visit = (relative) => {
    const entries = readdirSync(path.join(root, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const file = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (relative || ['src', 'public'].includes(entry.name)) visit(file);
      } else if (relative || /\.(?:html|[cm]?js|json)$/.test(entry.name)) {
        hash.update(file).update('\0').update(readFileSync(path.join(root, file))).update('\0');
      }
    }
  };
  visit('');
  hash.update(JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b, 'en'))));
  return hash.digest('hex').slice(0, 24);
}
