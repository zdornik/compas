import { readdir, readFile, writeFile } from 'node:fs/promises';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await compress(path);
    else if (/\.(html|mjs|js|css|json|webmanifest|svg)$/.test(entry.name)) {
      const content = await readFile(path);
      await writeFile(`${path}.br`, brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }));
      await writeFile(`${path}.gz`, gzipSync(content, { level: 9 }));
    }
  }
}
await compress('dist/client');
console.log('Static text compressed at build time; API responses remain no-store.');
