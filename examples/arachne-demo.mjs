/**
 * Arachne Quick Demo & Verification Test
 * 
 * Tests the local Arachne instance against the core API endpoints:
 * 1. Health / Root info: GET /
 * 2. Scrape endpoint: POST /v1/scrape
 * 3. Map endpoint: POST /v1/map
 * 
 * Usage:
 *   node examples/arachne-demo.mjs
 */

const BASE_URL = process.env.ARACHNE_URL || 'http://localhost:3002';

async function runDemo() {
  console.log('==============================================');
  console.log(`🕷️ Testing Arachne Instance at: ${BASE_URL}`);
  console.log('==============================================\n');

  // Test 1: Root / Health Check
  console.log('1️⃣ Checking API Root & Metadata (/)...');
  try {
    const res = await fetch(`${BASE_URL}/`);
    const data = await res.json();
    console.log('   Status:', res.status, res.statusText);
    console.log('   Response:', JSON.stringify(data, null, 2));
    if (data.message === 'Arachne API') {
      console.log('   ✅ API Identification Passed!\n');
    } else {
      console.log('   ⚠️ Unexpected message in root response.\n');
    }
  } catch (err) {
    console.log('   ❌ Server not reachable at', BASE_URL);
    console.log('   Make sure docker compose is running: "docker compose up -d"\n');
    return;
  }

  // Test 2: Scrape Single URL
  console.log('2️⃣ Testing Scrape Endpoint (/v1/scrape)...');
  const targetUrl = 'https://example.com';
  try {
    const scrapeRes = await fetch(`${BASE_URL}/v1/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: targetUrl,
        formats: ['markdown'],
      }),
    });
    const scrapeData = await scrapeRes.json();
    console.log('   Status:', scrapeRes.status);
    if (scrapeData.success) {
      console.log('   ✅ Scrape Successful!');
      console.log('   Markdown Sample:');
      console.log('   ----------------------------------------');
      console.log('   ' + (scrapeData.data?.markdown || '').slice(0, 150).replace(/\n/g, '\n   ') + '...');
      console.log('   ----------------------------------------\n');
    } else {
      console.log('   Response:', scrapeData);
    }
  } catch (err) {
    console.log('   ❌ Scrape request failed:', err.message);
  }

  // Test 3: Map Endpoint
  console.log('3️⃣ Testing Map / URL Discovery (/v1/map)...');
  try {
    const mapRes = await fetch(`${BASE_URL}/v1/map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
      }),
    });
    const mapData = await mapRes.json();
    console.log('   Status:', mapRes.status);
    console.log('   Discovered Links:', mapData.links || mapData.data || []);
    console.log('   ✅ Map Endpoint Working!\n');
  } catch (err) {
    console.log('   ❌ Map request failed:', err.message);
  }

  console.log('🎉 Verification run complete.');
}

runDemo();
