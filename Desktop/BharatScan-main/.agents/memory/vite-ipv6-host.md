---
name: Vite IPv6 host fix for Replit artifact workflows
description: Replit's waitForPort check for artifact workflows uses IPv6; Vite must bind to :: not 0.0.0.0
---

# Vite IPv6 Host Fix

**Rule:** Always use `--host ::` (not `--host 0.0.0.0`) for Vite dev servers in this project.

**Why:** Replit's `waitForPort` health check for artifact-managed workflows (`artifacts/<name>: web`) uses IPv6 (`::1`). When Vite binds only to `0.0.0.0` (IPv4), the check fails with `DIDNT_OPEN_A_PORT` even though the port IS open on IPv4. Changing to `::` makes Vite bind to all IPv6 interfaces (dual-stack on Linux, so IPv4 also works).

**How to apply:**
- `artifacts/bharatscan/package.json` dev/serve scripts: `--host ::`
- `artifacts/bharatscan/vite.config.ts` server.host and preview.host: `"::"`
- Do NOT revert to `"0.0.0.0"` or `true` — those only do IPv4.

**Confirmed working:**
- `artifacts/bharatscan: web` starts on port 22167 (Replit injects `PORT=22167`) and satisfies `waitForPort: 22167`
- `Start application` runs on port 5000 (explicit `PORT=5000` in workflow command)
- Both can coexist because they use different ports
