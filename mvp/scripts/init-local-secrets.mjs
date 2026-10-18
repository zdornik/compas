import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const demo = process.argv.includes('--demo');
const directory = demo ? '.demo-secrets' : '.local-secrets';
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
for (const name of ['admin_db_password', 'app_db_password', 'data_key', ...(demo ? ['demo_access_code','demo_tunnel_client_id'] : [])]) {
  const shortToken=name.startsWith('demo_');
  try { await writeFile(`${directory}/${name}`, randomBytes(shortToken ? 16 : 32).toString(shortToken ? 'base64url' : 'base64'), { flag: 'wx', mode: 0o644 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  // The parent is private (0700); the read-only secret mount must be readable
  // by the unprivileged container users, whose UIDs differ from the host user.
  await chmod(`${directory}/${name}`, 0o644);
}
console.log('Local secrets are ready. Existing keys were preserved.');
