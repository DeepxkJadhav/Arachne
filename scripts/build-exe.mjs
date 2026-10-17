import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, 'dist');

console.log('====================================================');
console.log('🕷️  ARACHNE — Standalone Windows Executable Builder');
console.log('====================================================');

if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// 1. Bundle bin/arachne.mjs with esbuild
console.log('\n[1/5] Bundling CLI with esbuild...');
execSync('npx --yes esbuild bin/arachne.mjs --bundle --platform=node --format=cjs --define:import.meta=false --outfile=dist/arachne.cjs', {
  stdio: 'inherit',
  cwd: ROOT_DIR
});

// 2. Generate sea-config.json
console.log('\n[2/5] Creating SEA configuration...');
const seaConfig = {
  main: 'dist/arachne.cjs',
  output: 'dist/sea-prep.blob',
  disableExperimentalSEAWarning: true
};
fs.writeFileSync(path.join(DIST_DIR, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));

// 3. Compile preparation blob
console.log('\n[3/5] Generating Node.js SEA blob...');
execSync('node --experimental-sea-config dist/sea-config.json', {
  stdio: 'inherit',
  cwd: ROOT_DIR
});

// 4. Copy node.exe binary
console.log('\n[4/5] Preparing base executable...');
const targetExe = path.join(DIST_DIR, 'arachne.exe');
fs.copyFileSync(process.execPath, targetExe);

// 5. Inject SEA blob into executable
console.log('\n[5/5] Injecting SEA blob via postject...');
execSync('npx --yes postject dist/arachne.exe NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', {
  stdio: 'inherit',
  cwd: ROOT_DIR
});

// Duplicate as arachne-windows-x64.exe for release convention
const releaseExe = path.join(DIST_DIR, 'arachne-windows-x64.exe');
fs.copyFileSync(targetExe, releaseExe);

const stat = fs.statSync(targetExe);
console.log('\n====================================================');
console.log('✅ BUILD COMPLETE: Standalone executable ready!');
console.log(`📁 Target File: ${targetExe} (${Math.round(stat.size / 1024 / 1024)} MB)`);
console.log(`📁 Release File: ${releaseExe}`);
console.log('====================================================\n');
