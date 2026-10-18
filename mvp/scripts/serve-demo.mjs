import { readFile } from 'node:fs/promises';
import { createDemoGate } from '../server/demo-gate.mjs';
const accessCode = (await readFile('/run/secrets/demo_access_code', 'utf8')).trim();
createDemoGate({ origin: process.env.SITE_ORIGIN, upstream: 'http://web:8080', accessCode }).listen(8081, '0.0.0.0', () => console.log('Demo access gate is ready. No request or form logging.'));
