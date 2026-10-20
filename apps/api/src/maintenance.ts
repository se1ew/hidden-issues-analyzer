import { maintainStorage } from './services/retention.service.js';
import { disconnectPrisma } from './lib/prisma.js';
try { console.log(JSON.stringify(await maintainStorage(process.argv.includes('--apply')), null, 2)); }
finally { await disconnectPrisma(); }
