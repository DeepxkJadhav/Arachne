# ARACHNE Testing & Verification Guide

This document describes how to execute the automated test suites, verify core subsystems, and validate end-to-end functionality across ARACHNE.

---

## 1. Quick Verification Commands

### 1.1 Complete Automated Subsystem Test Suite (32 Tests)
To verify all core systems, SSRF defense, native browser detection, task tab cleanup, transactional SQLite persistence, model latency benchmarks, live Telegram bot API handshake, approvals queue, **all 9 report format exports**, **Swarm Multi-Agent Orchestrator**, **Production Hybrid RAG**, **Contradiction Analysis**, and **Architecture Self-Introspection**:

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
• ARACHNE Core protocol root check (GET / with JSON Accept)... ✅ PASSED
• SSRF Defense: Block loopback IP (127.0.0.1)... ✅ PASSED
• SSRF Defense: Block AWS/GCP cloud metadata (169.254.169.254)... ✅ PASSED
• SSRF Defense: Block private Class A subnet (10.0.0.1)... ✅ PASSED
• Browser detection & profile discovery (/api/browser/status)... ✅ PASSED
• Task tab cleanup without touching user tabs (/api/browser/tabs/close)... ✅ PASSED
• Transactional SQLite metrics in WAL mode (/api/storage/metrics)... ✅ PASSED
• SQLite backup snapshot download (/api/storage/export)... ✅ PASSED
• Web Graph retrieval (/api/graph)... ✅ PASSED
• Knowledge Graph BFS Path Finding (/api/graph/path)... ✅ PASSED
• Model Studio connection test (/api/models/test)... ✅ PASSED
• Telegram Gateway status check (/api/telegram/status)... ✅ PASSED
• Live Telegram Bot API handshake test (/api/telegram/test)... ✅ PASSED
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
🏁 VERIFICATION COMPLETE: 32 Passed, 0 Failed (100% Success)
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
- Model router real latency benchmark
- Telegram `/status` response
- Autonomous research loop plan decomposition

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
```

---

## 2. Starting the ARACHNE Application

To run the ARACHNE Command Center on port 3003:

```powershell
node apps/desktop/start.mjs
```
Then navigate your browser to:
`http://localhost:3003/`
