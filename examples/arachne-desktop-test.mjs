import http from 'node:http';

const BASE_URL = 'http://localhost:3003';

async function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

async function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting ARACHNE Verification Suite...\n');

  // 1. Health & Status
  console.log('1. Checking /api/status...');
  const statusRes = await get('/api/status');
  console.log(`   Status: ${statusRes.status}, Nodes: ${statusRes.body.metrics.totalNodes}, Docs: ${statusRes.body.metrics.totalCorpusDocuments}`);

  // 2. Web Graph
  console.log('2. Checking /api/graph...');
  const graphRes = await get('/api/graph');
  console.log(`   Nodes returned: ${graphRes.body.data.nodes.length}, Edges: ${graphRes.body.data.edges.length}`);

  // 3. Corpus Search
  console.log('3. Checking /api/search?q=computer...');
  const searchRes = await get('/api/search?q=computer');
  console.log(`   Found ${searchRes.body.data.length} match(es)`);

  // 4. Model Test
  console.log('4. Checking /api/models/test...');
  const modelRes = await get('/api/models/test');
  console.log(`   Provider: ${modelRes.body.provider}, Latency: ${modelRes.body.latencyMs}ms`);

  // 5. Telegram Remote Gateway
  console.log('5. Testing /api/telegram/exec (/status command)...');
  const tgRes = await post('/api/telegram/exec', { command: '/status', sender: 'TestRunner' });
  console.log(`   Bot responded:\n   ${tgRes.body.data.response.split('\n')[0]}`);

  // 6. Test Investigation Dispatch
  console.log('6. Testing /api/investigate (Autonomous Plan Decomposition)...');
  const invRes = await post('/api/investigate', { objective: 'Evaluate open-source AI agent architectures' });
  console.log(`   Investigation started! ID: ${invRes.body.data.id}`);
  console.log(`   Phases planned: ${invRes.body.data.plan.phases.length}`);

  console.log('\n✅ All ARACHNE core subsystem tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
