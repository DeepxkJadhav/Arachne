import { createArachneServer } from './arachne-server.mjs';

const PORT = parseInt(process.env.PORT || '3003', 10);

console.log('---------------------------------------------------------');
console.log('🕷️  ARACHNE — Autonomous Web Intelligence & Research Engine');
console.log(`📡 Background Server Daemon listening on port ${PORT}`);
console.log('---------------------------------------------------------');

createArachneServer(PORT);
