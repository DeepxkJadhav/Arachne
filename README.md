<div align="center">
  <a name="readme-top"></a>
  <h1>🕷️ ARACHNE</h1>
  <p><b>Autonomous Web Intelligence, Browser Automation & Deep Research Command Center</b></p>

  <a href="https://github.com/DeepxkJadhav/Arachne/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/DeepxkJadhav/Arachne" alt="License">
  </a>
  <a href="https://github.com/DeepxkJadhav/Arachne">
    <img src="https://img.shields.io/github/stars/DeepxkJadhav/Arachne?style=social" alt="GitHub stars">
  </a>
  <a href="https://github.com/DeepxkJadhav/Arachne/issues">
    <img src="https://img.shields.io/github/issues/DeepxkJadhav/Arachne" alt="Issues">
  </a>
</div>

---

> [!NOTE]
> **ARACHNE** is an independent, permission-aware web intelligence and autonomous research platform maintained by [Deepak Jadhav (@DeepxkJadhav)](https://github.com/DeepxkJadhav). Built as a local-first, modular command center combining native Chrome/Brave browser automation, live knowledge graph synthesis, transactional SQLite storage, and deep multi-agent research orchestration.

---

## 🌟 Core Architectural Pillars

### 1. Native Browser Automation: Google Chrome & Brave
- **Zero Third-Party Scraping APIs:** Controls local Chrome and Brave browsers directly via the Chrome DevTools Protocol (CDP) over WebSocket.
- **Dedicated Profile Isolation:** Creates isolated automation profiles in `.arachne-vault/browser-profiles/{chrome,brave}`, ensuring user personal history, cookies, and active sessions remain completely untouched.
- **Task Tab Lifecycle:** Tracks tabs opened specifically for ARACHNE research tasks in `BrowserManager.activeTaskTabs`. Previous task preview tabs are closed cleanly before opening new URLs, preventing tab explosion and preserving personal tabs.

### 2. Live Research Loop & Evidence-Sufficiency Evaluator
- **8-Stage Iterative Loop:**
  $$\text{OBSERVE} \longrightarrow \text{INSPECT} \longrightarrow \text{EXTRACT} \longrightarrow \text{EVALUATE} \longrightarrow \text{SELECT NEXT} \longrightarrow \text{NAVIGATE} \longrightarrow \text{VERIFY} \longrightarrow \text{REPEAT}$$
- **Real-Time Screencasting:** Streams viewport screencast frames (`Page.captureScreenshot` Base64) to the live inspection deck on the main dashboard.
- **Evidence-Sufficiency Evaluator:** Evaluates accumulated evidence against the research objective:
  - **Question Coverage:** Quantifies what percentage of research questions are answered.
  - **Domain Diversity:** Prevents bias by scoring provenance across diverse independent domains.
  - **Corroboration Score:** Cross-validates claims across multiple sources before concluding investigations with high confidence.

### 3. Centralized System Settings (6 Integrated Sections)
- **Section A: System Status:** Real-time server uptime, Node.js v24 runtime status, SQLite WAL mode, database size, and total records.
- **Section B: Browser & Automation:** Chrome/Brave selector, profile discovery, CDP port configuration (9222), dedicated browser launch, and task tab cleanup.
- **Section C: Telegram Integration:** Live connection to `@arachnewi_bot`, masked token display (`8732••••••••••••••••••••••••71Wo`), numeric chat ID whitelist, background long-polling toggle, and live audit event log.
- **Section D: AI Models & Real Latency Testing:** Connects local Qwen via Ollama, LM Studio, OpenAI, or Anthropic. Tests perform **actual TCP/HTTP roundtrips** (zero synthetic or random numbers).
- **Section E: Storage & Retention:** Breakdown of all 11 relational tables, WAL integrity, SHA-256 content deduplication, and one-click SQLite database export.
- **Section F: Crawler & Safety Controls:** Enforces strict SSRF defense (blocking private subnets, loopbacks, and cloud metadata `169.254.169.254`), hop-by-hop redirect destination re-validation, 10MB response caps, and robots.txt compliance.

### 4. Natural-Language Telegram Integration
- **Direct Bot Control:** Fully wired to `@arachnewi_bot` (`8732300173:AAGj-fOkujR5PktCNVt3E2OQkr3vyDy71Wo`).
- **Strict Fail-Closed Authorization:** Enforces numeric user ID verification (`message.from.id`). String usernames are rejected to prevent impersonation. An empty allowlist fails closed.
- **Mission Intake:** Dispatches autonomous research missions directly from Telegram chat commands.

### 5. Transactional SQLite Persistence
- **ACID Transactions:** Powered by Node.js built-in `node:sqlite` (`DatabaseSync`) in Write-Ahead Logging (WAL) mode.
- **Automatic Crash Recovery:** Auto-detects interrupted investigations or unfinished checkpoints on reboot and safely restores state.
- **SHA-256 Deduplication:** Scraped documents are hashed and stored in `.arachne-vault/content/` to prevent redundant storage.

### 6. Zero-Dependency Report Studio (9 Formats)
Generates publication-quality intelligence dossiers across 9 standard formats without external heavy wrappers:
- **PDF-1.4:** Native binary serializer with page catalogs, fonts, and layout streams.
- **OpenXML (`.docx`, `.xlsx`, `.pptx`):** Packages zipped via native Node.js `node:zlib` with tables and charts.
- **Web & Plaintext (`.md`, `.html`, `.txt`):** Cybernetic-styled dossiers with citation tables.
- **Structured Data (`.json`, `.csv`):** Machine-readable records with relevance scores.

---

## 🚀 Quick Start

### 1. Launch ARACHNE Command Center
```bash
# Clone the repository
git clone https://github.com/DeepxkJadhav/Arachne.git
cd Arachne

# Start the ARACHNE application
node apps/desktop/start.mjs
```

Open your browser and navigate to:
👉 **`http://localhost:3003/`**

### 2. Run the Verification Suite (32 Tests)
```bash
node test/arachne-full-verification.mjs
```
Expected output:
```
================================================================
🕷️  ARACHNE FULL SUBSYSTEM VERIFICATION SUITE
================================================================
...
🏁 VERIFICATION COMPLETE: 32 Passed, 0 Failed (100% Success)
================================================================
```

---

## 💻 Interactive CLI Utility

ARACHNE includes a terminal CLI utility for inspecting intelligence without opening a browser:

```bash
# View system info & active investigation
node examples/arachne-cli.mjs info

# Inspect 4-agent swarm state (Scout, Analyst, Verifier, Synthesizer)
node examples/arachne-cli.mjs swarm

# Hybrid RAG search (BM25 + 3-gram cosine + RRF)
node examples/arachne-cli.mjs rag "autonomous agent architectures"

# Cross-source claim contradiction analysis
node examples/arachne-cli.mjs contradictions

# Architecture self-introspection graph
node examples/arachne-cli.mjs architecture
```

---

## 🛡️ Security Architecture

1. **SSRF Protection:** Built-in network guardrails reject connections to:
   - Loopback addresses (`127.0.0.0/8`, `::1`)
   - RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
   - Cloud metadata endpoints (`169.254.169.254`, `fe80::/10`)
2. **DNS Pre-Resolution:** Validates target IPs before socket creation, mitigating DNS rebinding attacks.
3. **Hop-by-Hop Redirect Revalidation:** Each redirect destination (up to 5 hops) is independently re-validated.
4. **Path Traversal Protection:** File exports sanitize filenames using `path.basename`.

---

## 📄 License

Distributed under the **AGPL-3.0 License**. See [LICENSE](file:///c:/Users/deepa/Documents/antigravity/sharp-mendeleev/LICENSE) for more information.
