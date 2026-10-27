import { rm } from 'node:fs/promises';

// Build outputs are generated; always start with an empty destination.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
