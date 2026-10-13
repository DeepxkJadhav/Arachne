# ARACHNE Testing & Verification Guide

This document describes how to execute tests, verify subsystems, and validate end-to-end functionality across ARACHNE.

---

## 1. Quick Verification Commands

### 1.1 Local Demo Server & Core Engine Verification
To verify the zero-dependency local engine (scraping, link discovery, and UI serving) without requiring Docker:

```powershell
# In c:\Users\deepa\Documents\antigravity\sharp-mendeleev
node examples/arachne-demo.mjs
```
*Expected Result:*
- Scrapes `https://example.com` in <500ms with title and markdown validation.
- Maps `https://github.com` and returns internal link structures.
- Tests API root endpoint on port 3002.

### 1.2 Interactive CLI Verification
```powershell
# Health check
node examples/arachne-cli.mjs info

# Test scrape
node examples/arachne-cli.mjs scrape https://example.com

# Test link discovery
node examples/arachne-cli.mjs map https://example.com
```

---

## 2. Running E2E and Unit Tests with pnpm Harness

In accordance with project conventions (`AGENTS.md`):
- End-to-end tests (referred to as `snips` in `apps/api`) are the primary verification standard.
- The test harness manages background dependencies automatically.

### 2.1 Running Specific Snip Tests
```powershell
# Run v1 snip tests
pnpm harness pnpm exec vitest run src/__tests__/snips/v1

# Run v2 agent and scrape tests
pnpm harness pnpm exec vitest run src/__tests__/snips/v2/agent-hints.test.ts

# Run deep research unit tests
pnpm harness pnpm exec vitest run src/__tests__/deep-research/unit
```

### 2.2 Test Environment Gates
Tests are gated by environment configuration:
- Tests requiring browser rendering (`fire-engine`): gated when `!process.env.TEST_SUITE_SELF_HOSTED`.
- Tests requiring AI completions: gated when `process.env.OPENAI_API_KEY` or `process.env.OLLAMA_BASE_URL` is configured.

---

## 3. Desktop Application & UI Verification

The ARACHNE Desktop UI can be verified across all 8 core views:
1. **Command Center:** Submit query "Find autonomous computer-use agents" -> verify task breakdown and live phase transition.
2. **Web Graph:** Verify graph renders nodes with colored badges for domain, document, and entity types; verify zoom, pan, and node inspection.
3. **Results & Search:** Perform keyword search -> verify ranked cards, relevance scores, and detail view.
4. **Report Studio:** Trigger report compile -> inspect Markdown, HTML, JSON, and CSV export artifacts.
5. **Model Studio:** Trigger provider latency ping (Ollama / OpenAI / mock) -> verify status indicator.
6. **Knowledge Vault:** Verify persistence of bookmarked sources and extracted claims.
7. **Telegram Control:** Verify simulated bot commands `/status`, `/investigate <topic>`, `/pause`.
8. **Settings:** Verify adjustment of crawl concurrency, rate limits, and depth parameters.
