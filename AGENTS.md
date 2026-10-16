# ARACHNE — Autonomous Web Intelligence & Research CLI

ARACHNE is a terminal-first, autonomous web intelligence and deep research engine maintained by Deepak Jadhav (@DeepxkJadhav).

## Architecture

- `bin/arachne.mjs`: High-performance terminal CLI with black, white, and crimson/red aesthetic, interactive REPL, and deterministic intent routing.
- `server/`: Autonomous web intelligence core server:
  - `server/agent/`: Research orchestrator, intent classifier, and swarm coordinator.
  - `server/browser/`: Native Chrome/Brave CDP automation with isolated profiles and real viewport capture.
  - `server/crawler/`: Content extractor, link frontier, SSRF guard, and robots.txt compliance.
  - `server/graph/`: In-memory & SQLite WAL knowledge graph engine.
  - `server/models/`: Real latency-tested AI model routing (Qwen via Ollama, LM Studio, Groq Cloud, etc.).
  - `server/reports/`: Zero-dependency 9-format dossier compilation (PDF, TXT, HTML, XLSX, DOCX, PPTX, CSV, JSON, MD).
  - `server/telegram/`: Fail-closed Telegram bot with numeric authorization.
  - `server/vault/`: Transactional SQLite persistence, WAL journal mode, and SHA-256 deduplication.
- `test/`: Comprehensive acceptance and regression test suites.
- `scripts/`: System PATH registration for global `arachne` CLI command.

## Running & Testing

1. Start CLI: `npm start` or `arachne`
2. Start Server Daemon: `npm run server`
3. Run Master E2E Tests: `npm test`
4. Run Regression Tests: `npm run test:regression`
5. Run All Tests: `npm run test:all`