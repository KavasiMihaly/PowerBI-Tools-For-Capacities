# Backlog

| ID | Backlog Item | Epic | Phase | Plan File | Research File | State |
|---|---|---|---|---|---|---|
| R1 | Document fork vs Microsoft upstream baseline | RealisticLoadTest v2 | Research | _ | `_Research/realisticloadtest-fork-vs-upstream.md` | Done |
| R2 | Research modern PBI JS SDK & load testing landscape | RealisticLoadTest v2 | Research | _ | `_Research/modern-pbi-loadtest-landscape.md` | Done |
| R3 | Synthesize research findings | RealisticLoadTest v2 | Research | _ | `_Research/RealisticLoadTest-research-summary.md` | Done |
| R4 | Decide modernization scope & phasing | RealisticLoadTest v2 | Planning | `_Plan/realisticloadtest-v2.md` | _ | Done |
| R5 | Draft phased implementation plan | RealisticLoadTest v2 | Planning | `_Plan/realisticloadtest-v2.md` | All 3 above | Done |
| **B1** | Structured JSONL log output replacing HTML-with-`<br>` | RealisticLoadTest v2 | v0.8 | `_Plan/realisticloadtest-v2.md` (§v0.8-T4) | `_Research/RealisticLoadTest-research-summary.md` | Backlog |
| **B2** | Local-browser UI (`Setup.html`) replacing PowerShell setup | RealisticLoadTest v2 | v1.0 | `_Plan/realisticloadtest-v2.md` (§v1.0-T8) | `_Research/modern-pbi-loadtest-landscape.md` (§5.7) | Backlog |
| **B3** | Host resource monitor sidecar (CPU/RAM/network) with saturation flagging | RealisticLoadTest v2 | v1.0 | `_Plan/realisticloadtest-v2.md` (§v1.0-T10) | _ | Backlog |
| **B4a** | Single-machine easy-install (winget + zip) | RealisticLoadTest v2 | v1.0 | `_Plan/realisticloadtest-v2.md` (§v1.0-T12) | _ | Backlog |
| **B4b** | Multi-VM architecture-ready (coordinator HTTP API, JSONL streaming) | RealisticLoadTest v2 | v1.0 | `_Plan/realisticloadtest-v2.md` (§v1.0-T11) | `_Research/modern-pbi-loadtest-landscape.md` (§5.6) | Backlog |
| **B4c** | Multi-VM distributed implementation (Playwright + IaC + SP) | RealisticLoadTest v2 | v2.0 | `_Plan/realisticloadtest-v2.md` (§v2.0) | `_Research/modern-pbi-loadtest-landscape.md` (§5.4, §5.8) | Future |
| T1 | Vendor `powerbi-client@2.23.x`, kill rawgit dependency | RealisticLoadTest v2 | v0.8 | `_Plan/realisticloadtest-v2.md` (§v0.8-T1) | `_Research/modern-pbi-loadtest-landscape.md` (§1) | Backlog |
| T2 | Drop jQuery — vanilla JS replacements | RealisticLoadTest v2 | v0.8 | `_Plan/realisticloadtest-v2.md` (§v0.8-T2) | `_Research/modern-pbi-loadtest-landscape.md` (§1) | Backlog |
| T3 | Upgrade SDK to 2.23.x | RealisticLoadTest v2 | v0.8 | `_Plan/realisticloadtest-v2.md` (§v0.8-T3) | `_Research/modern-pbi-loadtest-landscape.md` (§1) | Backlog |
| T5 | MSAL.js in-browser token refresh via `accessTokenProvider` | RealisticLoadTest v2 | v0.8 | `_Plan/realisticloadtest-v2.md` (§v0.8-T5) | `_Research/modern-pbi-loadtest-landscape.md` (§2) | Backlog |
| T6 | Fix `numberOfViews` off-by-one (`16/15` bug) | RealisticLoadTest v2 | v0.8 | `_Plan/realisticloadtest-v2.md` (§v0.8-T6) | `_Research/realisticloadtest-fork-vs-upstream.md` (§3) | Backlog |
| T7 | Update Readme + UserGuide for v0.8 | RealisticLoadTest v2 | v0.8 | `_Plan/realisticloadtest-v2.md` (§v0.8-T7) | _ | Backlog |
| T9 | Centralized `loadtest.yaml` config | RealisticLoadTest v2 | v1.0 | `_Plan/realisticloadtest-v2.md` (§v1.0-T9) | `_Research/modern-pbi-loadtest-landscape.md` (§5.7) | Backlog |
| T11 | Real-time aggregated dashboard (coordinator) | RealisticLoadTest v2 | v1.0 | `_Plan/realisticloadtest-v2.md` (§v1.0-T11) | `_Research/modern-pbi-loadtest-landscape.md` (§5.6) | Backlog |
| TP1 | Write `_Test/v0.8-test-plan.md` | RealisticLoadTest v2 | v0.8 | `_Plan/realisticloadtest-v2.md` (§Test plans) | _ | Done |
| TP2 | Write `_Test/v1.0-test-plan.md` | RealisticLoadTest v2 | v1.0 | `_Plan/realisticloadtest-v2.md` (§Test plans) | _ | Done |
| TP3 | Capture v0.7.1 baseline metrics → `_Test/baselines/v0.7.1/` | RealisticLoadTest v2 | v0.8 | `_Plan/realisticloadtest-v2.md` (§Implementation order step 5) | _ | Backlog |
| TS1 | Write v0.8 testing summary at `_Test/v0.8-results.md` | RealisticLoadTest v2 | v0.8 | `_Plan/realisticloadtest-v2.md` (§Implementation order step 7) | _ | Backlog |
| TS2 | Write v1.0 testing summary at `_Test/v1.0-results.md` | RealisticLoadTest v2 | v1.0 | `_Plan/realisticloadtest-v2.md` (§Implementation order step 8) | _ | Backlog |
