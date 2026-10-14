# ARACHNE Testing & Verification Guide

This document describes how to execute the automated test suites, verify core subsystems, and validate end-to-end functionality across ARACHNE.

---

## 1. Quick Verification Commands

### 1.1 Complete Automated Subsystem Test Suite (25 Tests)
To verify all core systems, crawler frontier, BFS knowledge graph path finding, model router, Telegram bot commands, approvals queue, **all 9 report format exports**, **Swarm Multi-Agent Orchestrator**, **Production Hybrid RAG**, **Contradiction Analysis**, and **Architecture Self-Introspection**:

```powershell
# Ensure ARACHNE server is running on port 3003
node test/arachne-full-verification.mjs
```
*Expected Output:*
```
================================================================
🕷️  ARACHNE FULL SUBSYSTEM VERIFICATION SUITE
================================================================

• System status check (/api/status)... ✅ PASSED
• Firecrawl base protocol root check (GET / with JSON Accept)... ✅ PASSED
• Firecrawl scrape endpoint (/v1/scrape)... ✅ PASSED
• Firecrawl map endpoint (/v1/map)... ✅ PASSED
• Web Graph retrieval (/api/graph)... ✅ PASSED
• Knowledge Graph BFS Path Finding (/api/graph/path)... ✅ PASSED
• Model Studio connection test (/api/models/test)... ✅ PASSED
• Telegram Bot remote status command (/api/telegram/exec)... ✅ PASSED
• Telegram Bot findings inspection (/top5)... ✅ PASSED
• Report Generation in all 9 formats (/api/report/generate)... ✅ PASSED
• Download report format: .MD... ✅ PASSED
• Download report format: .TXT... ✅ PASSED
• Download report format: .HTML... ✅ PASSED
• Download report format: .CSV... ✅ PASSED
• Download report format: .JSON... ✅ PASSED
• Download report format: .PDF... ✅ PASSED
• Download report format: .DOCX... ✅ PASSED
• Download report format: .XLSX... ✅ PASSED
• Download report format: .PPTX... ✅ PASSED
• Approvals pending list check (/api/approvals/pending)... ✅ PASSED
• Corpus search & relevance ranking (/api/search)... ✅ PASSED
• Swarm Multi-Agent State check (/api/swarm)... ✅ PASSED
• Hybrid RAG Semantic Retrieval (/api/rag/search?q=...)... ✅ PASSED
• RAG Cross-Source Contradiction Analysis (/api/rag/contradictions)... ✅ PASSED
• Architecture Self-Introspection Graph (/api/system/architecture)... ✅ PASSED

================================================================
🏁 VERIFICATION COMPLETE: 25 Passed, 0 Failed
================================================================
```

### 1.2 Core Desktop Engine Verification
```powershell
node examples/arachne-desktop-test.mjs
```
*Validates:*
- `/api/status` metrics
- Web graph node & edge counts
- Corpus search for query `"computer"`
- Model router latency benchmark
- Telegram `/status` response
- Autonomous 5-phase plan decomposition

### 1.3 Interactive CLI Verification
```powershell
# Server health and active investigation check
node examples/arachne-cli.mjs info

# Inspect 4-agent swarm state (Scout, Analyst, Verifier, Synthesizer)
node examples/arachne-cli.mjs swarm

# Hybrid RAG search (BM25 + 3-gram cosine + RRF)
node examples/arachne-cli.mjs rag "autonomous agent computer use"

# Audit cross-source claim contradictions
node examples/arachne-cli.mjs contradictions

# Architecture self-introspection graph
node examples/arachne-cli.mjs architecture

# Test scrape
node examples/arachne-cli.mjs scrape https://arxiv.org/abs/2410.03840

# Test link mapping
node examples/arachne-cli.mjs map https://arxiv.org
```

---

## 2. Starting the ARACHNE Application

To run the ARACHNE Desktop/Web Command Center on port 3003:

```powershell
node apps/desktop/start.mjs
```
Then navigate your browser to:
`http://localhost:3003/`

---

## 3. Manual Screen-by-Screen Walkthrough

1. **Screen 1: Command Center & Chat**
   - Enter an objective (e.g. `"Research latest open-source autonomous computer-use agents"`).
   - Observe the 60FPS mechanical spider tracking cursor movement.
   - Click `Pause`, `Resume`, and `Retry` buttons to observe pipeline state transitions.
   - When an approval is requested, verify `#approval-alert-banner` displays with `Approve` and `Reject` buttons.

2. **Screen 2: Web Graph**
   - Click `Web Graph` in top bar or sidebar.
   - Observe animated particle data flow along edges.
   - Click a node to view the Node Details drawer.
   - Use Zoom In, Zoom Out, and Fit to View controls.

3. **Screen 3: Results**
   - Filter results by content type (`Web Page`, `Research Paper`, `GitHub Repository`).
   - Adjust Min Relevance threshold slider.
   - Click any card to launch the **Hunter's Vision Autopsy Modal** with cryptographic SHA-256 validation.

4. **Screen 4: Report Studio**
   - Select format checkboxes (`PDF`, `DOCX`, `XLSX`, `PPTX`, `Markdown`, `HTML`, `CSV`, `JSON`, `TXT`).
   - Click `✨ Generate Report`.
   - Download generated files in any of the 9 formats and verify they open in their respective viewers (Adobe Acrobat / Word / Excel / PowerPoint / VS Code).

5. **Screen 5: Telegram Control**
   - Type `/status`, `/top5`, or `/report` in the interactive chat box.
   - Observe instantaneous response synchronized with the desktop backend.

6. **Screen 6: Model Studio**
   - Click on different model fleet cards (`Qwen 2.5 Local`, `Llama 3.1 Local`, `GPT-4o API`, `Claude 3.5 API`).
   - Adjust Temperature and Max Output Token sliders.
   - Click `Test Latency` and `Test All` to benchmark model response times.

7. **Screen 7: Settings (5-Column Layout)**
   - Adjust Max Concurrent Requests and Request Delay sliders.
   - Add a domain to the allowlist (e.g. `huggingface.co`) and remove chips on click.
   - Select an accent color swatch (`#9d4edd`, `#f72585`, `#ff0054`, `#4cc9f0`, `#10b981`) to dynamically update UI themes.
   - Click `Save All Settings` to persist configurations to `.arachne-vault/vault-db.json`.

8. **Screen 8: Knowledge Vault**
   - Filter by Time Horizon (`All Time`, `Past 24 Hours`, `Past 7 Days`, `Past 30 Days`).
   - Click any item to inspect its preview.
   - Switch preview tabs between `Content`, `Metadata`, `Links`, and `Entities`.
   - Click `Export` to download structured JSON.
