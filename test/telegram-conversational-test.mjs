import http from 'node:http';
import assert from 'node:assert';

const BASE_URL = 'http://localhost:3003';

async function postExec(senderId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ senderId, text });
    const req = http.request(new URL('/api/telegram/exec', BASE_URL), {
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
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('================================================================');
  console.log('🕷️  ARACHNE TELEGRAM CONVERSATIONAL & FAIL-CLOSED GATEWAY TEST');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`• ${name}... `);
    try {
      await fn();
      console.log('✅ PASS');
      passed++;
    } catch (e) {
      console.log('❌ FAIL');
      console.error('  ', e.message);
      failed++;
    }
  }

  // 1. Fail-closed: Unauthorized Telegram User ID
  await test('Fail-Closed Gate blocks unauthorized User ID 999999999', async () => {
    const res = await postExec('999999999', 'What is your status?');
    assert.strictEqual(res.success, false, 'Must deny unauthorized sender');
    assert(res.denied === true || (res.data?.response && res.data.response.includes('Access Denied')));
  });

  // 2. Fail-closed: Non-numeric username rejected
  await test('Fail-Closed Gate blocks non-numeric username', async () => {
    const res = await postExec('@unauthorized_user', 'Help');
    assert.strictEqual(res.success, false, 'Must deny non-numeric username');
  });

  // 3. Authorized Operator: Natural language status query
  await test('Natural Language Intent: "what is your status?"', async () => {
    const res = await postExec('123456789', 'what is your status?');
    assert.strictEqual(res.success, true);
    assert(res.data?.response.includes('ARACHNE System Status') || res.data?.response.includes('Investigation Status'));
  });

  // 4. Authorized Operator: Conversational progress query
  await test('Natural Language Intent: "how far are you?"', async () => {
    const res = await postExec('123456789', 'how far are you?');
    assert.strictEqual(res.success, true);
    assert(res.data?.response.includes('Status:'));
  });

  // 5. Authorized Operator: Natural language pause
  await test('Natural Language Intent: "pause research"', async () => {
    const res = await postExec('123456789', 'pause research');
    assert.strictEqual(res.success, true);
    assert(res.data?.response.includes('Paused'));
  });

  // 6. Authorized Operator: Natural language resume
  await test('Natural Language Intent: "continue crawling"', async () => {
    const res = await postExec('123456789', 'continue crawling');
    assert.strictEqual(res.success, true);
    assert(res.data?.response.includes('Resumed'));
  });

  // 7. Authorized Operator: Natural language report export as PDF
  await test('Natural Language Intent: "export report as pdf"', async () => {
    const res = await postExec('123456789', 'export report as pdf');
    assert.strictEqual(res.success, true);
    assert(res.data?.response.includes('PDF') || res.data?.response.includes('Research Report Exported'));
  });

  // 8. Authorized Operator: Natural language report export as Excel
  await test('Natural Language Intent: "give me excel report"', async () => {
    const res = await postExec('123456789', 'give me excel report');
    assert.strictEqual(res.success, true);
    assert(res.data?.response.includes('XLSX') || res.data?.response.includes('Research Report Exported'));
  });

  // 9. Authorized Operator: Natural language findings query
  await test('Natural Language Intent: "what have you found so far?"', async () => {
    const res = await postExec('123456789', 'what have you found so far?');
    assert.strictEqual(res.success, true);
    assert(res.data?.response.includes('Discoveries') || res.data?.response.includes('findings'));
  });

  // 10. Authorized Operator: Natural language help
  await test('Natural Language Intent: "what can you do"', async () => {
    const res = await postExec('123456789', 'what can you do');
    assert.strictEqual(res.success, true);
    assert(res.data?.response.includes('ARACHNE Autonomous Web Intelligence Bot'));
  });

  console.log(`\n================================================================`);
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log(`================================================================`);
  if (failed > 0) process.exit(1);
}

run().catch(console.error);
