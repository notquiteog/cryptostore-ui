import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Keep the existing worker path/scope (and push subscriptions), but change
 * its bytes on every changed release. A version only in the registering page's URL
 * cannot tell an already-open page that a deployment happened. */
export function pwaBuild(buildId) {
  let outDir;
  return {
    name: 'store-pwa',
    apply: 'build',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'cs-build', content: buildId }, injectTo: 'head' }];
    },
    async writeBundle(_options, bundle) {
      const workerPath = path.join(outDir, 'sw-push.js');
      const source = await readFile(workerPath, 'utf8');
      // Include lazy chunks too: an update must be complete before it is
      // offered, and an offline visit must not depend on prior route visits.
      const assets = Object.keys(bundle).filter((file) => file.startsWith('assets/'));
      await writeFile(workerPath, source
        .replace("'__CS_BUILD_ID__'", JSON.stringify(buildId))
        .replace('/* __CS_PRECACHE__ */ []', JSON.stringify(assets.map((file) => `/${file}`))));
    },
  };
}
