# EVM Bots Codebase Audit Report

**Date:** 2026-06-08  
**Auditor:** Kilo Code Audit  
**Scope:** Full codebase review including Workers (funbo, funbo-execution, funbo-discovery, funbo-analytics), Shared modules, Dashboard (React/TSX), and Hardhat contracts

---

## Executive Summary

The EVM Bots codebase is a sophisticated DeFi trading system built on Cloudflare Workers with 4 independent services sharing a single D1 database. The system demonstrates advanced patterns for arbitrage, spot trading, and triangular arbitrage across multiple EVM chains. While the codebase is well-architected and the documented fixes in STATUS.md show active maintenance, several **critical issues** were identified that could cause runtime errors or security vulnerabilities.

---

## Critical Issues (Severity: High)

### 1. Syntax Error in funbo-execution/src/index.ts (Line 182-261)

**Location:** `worker/funbo-execution/src/index.ts`, function `executePendingOpportunities`

**Issue:** Malformed try-catch block structure causes parsing/syntax errors. Lines 182-256 have nested try-catch blocks with improper indentation and a duplicate catch block at line 256-260 that references `opp` variable outside its scope.

```typescript
// Current (broken) structure:
try {
  // ... code ...
} catch (err: any) {
  // ...
  return false;
} catch (err: any) {  // <-- Duplicate catch block
  console.log(`[executor] opp #${opp.id} unhandled error: ${err.message}`);
  // ...
}
```

**Impact:** The worker may fail to deploy or execute opportunities.

**Recommendation:** Refactor the try-catch structure to have single catch blocks per try statement.

---

### 2. Missing Auth Validation on Discovery/Execution/Analytics Workers

**Location:** `worker/funbo-discovery/src/index.ts`, `worker/funbo-analytics/src/index.ts`, `worker/funbo-execution/src/index.ts`

**Issue:** These workers have no API key validation middleware. The gateway forwards `X-API-Key` headers but workers don't validate them.

**Impact:** If worker `.workers.dev` URLs are discovered, they can be called directly without authentication (Security Gap documented in STATUS.md line 277-278).

**Recommendation:** Add auth middleware to all workers, or remove direct public access by not binding them to `.workers.dev`.

---

### 3. Potential Null/Undefined Reference in SoloSpotStrategyManager

**Location:** `dashboard/src/api/client.ts`, line 209

**Issue:** `soloSpotStrategyService.execute()` calls `/api/solo-spot/execute` without passing required `chainId` parameter that the endpoint needs.

**Impact:** Solo-spot trades may fail silently or execute on wrong chain.

---

### 4. Stale RPC Endpoints in DEFAULT_POOLS

**Location:** `worker/funbo/src/index.ts`, lines 190-198

**Issue:** Default RPC pools still include `rpc.ankr.com` which was noted as defunct in STATUS.md (line 139: "Network RPC URL updated from defunct Ankr to `polygon.drpc.org`").

**Impact:** RPC calls to Ankr endpoints will fail, causing fallback to slower endpoints.

---

## High Priority Issues

### 5. Decimal Cache Key Collision Risk (Partially Fixed)

**Location:** `worker/funbo-execution/src/bot-engine.ts`, line 5

**Issue:** The `decimalCache` key is just `tokenAddress` without chain ID. If tokens with same address exist on different chains, cache collisions can occur.

**Status:** Partly addressed in discovery worker (line 620 uses `${chainId}:${token.toLowerCase()}`) but NOT in execution worker.

**Recommendation:** Update execution worker to use chain-prefixed cache keys.

---

### 6. Empty String Default Values for Required Fields

**Location:** Multiple dashboard components and API endpoints

**Issue:** Several form defaults default to empty strings instead of proper defaults, causing validation issues:
- `executor_mode` defaults: fixed to `'direct'` ✓
- `auto_discover_source` defaults: fixed to `'gecko'` ✓
- But many inputs in `ConfigManager.tsx` still default to empty strings

**Impact:** UI forms may submit empty values causing database NULL issues.

---

### 7. Potential Missing Config Keys

**Location:** `worker/funbo-execution/src/bot-engine.ts`, multiple locations

**Issue:** Config queries assume keys exist but don't always have proper fallbacks:
- `min_net_profit_pct` used at line 939 but could be undefined
- `feeTier` used at line 938 before being set from config

---

## Medium Priority Issues

### 8. Duplicate encodeV3Path Function

**Location:** Both `worker/funbo-execution/src/index.ts` (line 175-180) and `worker/funbo-discovery/src/index.ts` (line 663-668)

**Issue:** The same utility function is defined in multiple places, creating maintenance burden.

**Recommendation:** Move to shared module `worker/shared/`.

---

### 9. Hardcoded Native Token Addresses

**Location:** `worker/funbo-execution/src/bot-engine.ts`, lines 402-408 and 1128-1134

**Issue:** Native token addresses hardcoded for only 5 chains. Adding support for new chains requires code changes.

**Status:** Documented in STATUS.md line 406 as known issue.

---

### 10. Bot Engine Missing `bot_transactions` Table Initialization

**Location:** `worker/funbo/src/db.ts`

**Issue:** Migration scripts create `trades`, `spot_strategies`, `spot_positions` tables but NOT `bot_transactions` table referenced in `bot-engine.ts` (lines 74-96).

**Impact:** Calls to `recordBotTransaction` may fail if table doesn't exist.

---

### 11. Pending Opportunities Table Schema Mismatch

**Location:** `worker/funbo/src/db.ts`, line 43

**Issue:** `opportunities` table schema doesn't include `executed_at` or `error_msg` columns shown in STATUS.md migration 006 and 024, but the code references these.

**Status:** Migrated in code but NOT in base schema definition.

---

### 12. V3 Fee Tier Validation Missing

**Location:** `worker/funbo-execution/src/bot-engine.ts`, line 373

**Issue:** Fee tiers iteration `[1000, 3000, 500, 10000, 100]` is hardcoded without validation against the router's supported tiers.

**Impact:** May attempt quotes on unsupported fee tiers.

---

### 13. Missing .dev.vars Template Files

**Location:** All worker directories

**Issue:** No `.dev.vars` template files for local development. Developers need to know which environment variables are required.

**Required vars likely include:**
- `PRIVATE_KEY` - Wallet private key for transactions
- `GOPLUS_API_KEY` - GoPlus token safety API
- `BLOCKSCOUT_API_KEY` - Blockscout PRO API
- `TELEGRAM_BOT_TOKEN` - Telegram notifications
- `DISCORD_WEBHOOK_URL` - Discord notifications
- `EXECUTION_WORKER_URL` / `DISCOVERY_WORKER_URL` - For gateway forwarding

---

### 14. GitHub Actions Worker URL Hardcoded

**Location:** `dashboard/.github/workflows/bot-crons.yml`

**Issue:** Worker URLs (`funbo-discovery.nobtx-io.workers.dev`, `funbo-execution.nobtx-io.workers.dev`) are hardcoded in workflow, making it non-portable for forks or different environments.

**Impact:** Deployment requires manual URL updates.

---

## Low Priority Issues

### 15. Dashboard Type Safety Issues

**Location:** `dashboard/src/api/types.ts` (exists but needs verification)

**Issue:** No explicit review done - should verify types match API responses, especially `NodeHealth` type with `chain_id` vs `chainId` (documented in STATUS.md line 174).

---

### 16. Unused Imports in Shared Modules

**Location:** `worker/funbo-execution/src/api-providers.ts`

**Issue:** Re-exports all functions from shared, not all may be used.

---

### 17. Missing Package.json Dev Dependencies Symmetry

**Location:** `worker/funbo-execution/package.json` vs `worker/funbo-discovery/package.json`

**Issue:** Different scripts: execution has `"typecheck": "tsc --noEmit"` while discovery has `"build": "tsc --noEmit"`. Discovery missing typecheck script.

---

## Security Analysis

### Authentication & Authorization
- ✅ Gateway (funbo) has proper API key validation
- ❌ Discovery, Execution, Analytics workers have NO auth middleware
- ⚠️ Security layers exist but are not mandatory for all trades (well-known tokens bypass them)

### Token Safety Checks
- ✅ GoPlus integration for honeypot/blacklist detection
- ✅ Blockscout contract verification checks
- ✅ Token trade history validation (min 10 holders, 5 txs)
- ⚠️ Well-known tokens bypass ALL security checks - intentional but documented

### Risk Management
- ✅ Circuit breaker for daily loss limits
- ✅ Risk rules (balance thresholds)
- ✅ AI-based trade scoring with `critical` risk blocking
- ✅ Slippage auto-calculation

---

## Architecture Assessment

### Strengths
1. **Clean separation of concerns** - Each worker has a distinct role
2. **Shared modules for common functionality** - Reduces duplication
3. **Configuration-driven thresholds** - Min profit, slippage, balance limits are DB-configurable
4. **Multiple execution modes** - Direct, Contract, and Hybrid (become) modes
5. **Comprehensive error logging** - All critical paths have try-catch with logging

### Areas for Improvement
1. **Inter-worker communication** - Gateway→worker proxy noted as broken (error 1042) in STATUS.md
2. **CPU limit handling** - Requires careful rate limiting (500 quote limit)
3. **Re-quote before execution** - Currently uses stale prices causing "Round-trip lost" errors

---

## File-by-File Findings

| File | Findings |
|------|----------|
| `worker/funbo/src/index.ts` | Well-structured, missing RPC pool tests, secure |
| `worker/funbo-execution/src/index.ts` | **Syntax error in try-catch**, needs auth middleware |
| `worker/funbo-discovery/src/index.ts` | Good structure, duplicate encodeV3Path, no auth |
| `worker/funbo-analytics/src/index.ts` | Clean, no auth middleware, needs wrangler config |
| `worker/shared/rate-limiter.ts` | Well-implemented rate limiting |
| `worker/shared/ai-advisor.ts` | Clean AI orchestration logic |
| `worker/shared/api-providers.ts` | Comprehensive provider integrations |
| `worker/funbo-execution/src/bot-engine.ts` | Large file but well-organized, missing chain-prefix cache |
| `dashboard/src/api/client.ts` | Clean service definitions, missing chainId in execute |
| `dashboard/src/components/ConfigManager.tsx` | Good UI/UX, some empty string defaults |
| `dashboard/src/components/Login.tsx` | Secure authentication flow |
| `hardhat/artifacts/.../ArbExecutor.json` | Valid contract artifact |

---

## Recommendations Summary

### Immediate (Critical)
1. Fix syntax error in `executePendingOpportunities` function
2. Add auth middleware to discovery/execution/analytics workers OR restrict public access

### Short-term (High)
3. Update `decimalCache` key to include chain ID in execution worker
4. Remove stale Ankr RPC endpoints from DEFAULT_POOLS
5. Add `bot_transactions` table to schema migrations
6. Create `.dev.vars` template files for all workers
7. Move hardcoded worker URLs to environment variables in CI

### Medium-term
8. Consolidate `encodeV3Path` into shared module
9. Add config key validation for required values
10. Add V3 fee tier validation against router capabilities
11. Sync package.json scripts across workers

---

## Conclusion

The EVM Bots codebase is well-designed for a production DeFi trading system with comprehensive security layers, rate limiting, and multi-mode execution. The main issues are:

1. A critical syntax error preventing proper worker operation
2. Missing authentication on backend workers (security risk)
3. Minor inconsistencies in configuration and caching

With the fixes documented in STATUS.md already applied, addressing the critical issues above would significantly improve the system's reliability and security posture.

