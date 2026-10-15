import { execSync } from 'node:child_process';
import assert from 'node:assert';

console.log('================================================================');
console.log('🕷️  ARACHNE GLOBAL WINDOWS COMMAND & SLASH SYNTAX AUDIT');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  process.stdout.write(`• ${name}... `);
  try {
    fn();
    console.log('✅ PASS');
    passed++;
  } catch (e) {
    console.log('❌ FAIL');
    console.error('  ', e.message);
    failed++;
  }
}

// 1. Run arachne --version from C:\Users\deepa
test('Execute "arachne --version" from external directory C:\\Users\\deepa', () => {
  const out = execSync('arachne --version', { cwd: 'C:\\Users\\deepa', encoding: 'utf8' }).trim();
  assert(out.includes('arachne 2.0.0'), `Expected "arachne 2.0.0", got "${out}"`);
});

// 2. Run arachne /status --json
test('Execute "arachne /status --json" with slash syntax', () => {
  const out = execSync('arachne /status --json', { cwd: 'C:\\Users\\deepa', encoding: 'utf8' });
  const json = JSON.parse(out);
  assert(json.status && json.status.success, 'Status json should have success: true');
  assert.strictEqual(json.status.system, 'ARACHNE Web Intelligence Command Center');
});

// 3. Run arachne /vault --json
test('Execute "arachne /vault --json" with slash syntax', () => {
  const out = execSync('arachne /vault --json', { cwd: 'C:\\Users\\deepa', encoding: 'utf8' });
  const json = JSON.parse(out);
  assert(json.vaultPath && json.sqlitePath, 'Vault json should have paths');
  assert(typeof json.totalBytes === 'number', 'totalBytes should be numeric');
});

// 4. Run arachne /settings --json
test('Execute "arachne /settings --json" with slash syntax', () => {
  const out = execSync('arachne /settings --json', { cwd: 'C:\\Users\\deepa', encoding: 'utf8' });
  const json = JSON.parse(out);
  assert(json.activeModelProvider, 'Should contain activeModelProvider');
  assert(json.allowedTelegramUserIds, 'Should contain allowedTelegramUserIds');
});

// 5. Run arachne /hunts --json
test('Execute "arachne /hunts --json" with slash syntax', () => {
  const out = execSync('arachne /hunts --json', { cwd: 'C:\\Users\\deepa', encoding: 'utf8' });
  const json = JSON.parse(out);
  assert(Array.isArray(json), 'Hunts should return array');
});

// 6. Test Color Palette on global /status output
test('Strict hacker color palette on global command output (NO green/cyan/yellow)', () => {
  const out = execSync('arachne /status', { cwd: 'C:\\Users\\deepa', encoding: 'utf8' });
  const forbiddenAnsi = [/\x1b\[32m/, /\x1b\[92m/, /\x1b\[36m/, /\x1b\[96m/, /\x1b\[33m/, /\x1b\[93m/, /\x1b\[35m/, /\x1b\[95m/];
  for (const pattern of forbiddenAnsi) {
    assert(!pattern.test(out), `Detected forbidden ANSI sequence matching ${pattern}`);
  }
});

console.log(`\n================================================================`);
console.log(`Results: ${passed} Passed, ${failed} Failed`);
console.log(`================================================================`);
if (failed > 0) process.exit(1);
