# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## mobile-search-quality — transient Bilibili 412 ended mobile search before a bounded retry
- **Date:** 2026-09-13
- **Error patterns:** Bilibili search, HTTP 412, transient provider error, anonymous upstream denial, empty search result
- **Root cause(s):** AND-gated: Bilibili intermittently rejects anonymous search with HTTP 412, and mobile requestJson stops after the first failed attempt even though an identical immediate request can succeed.
- **Fix:** Added one immediate retry for retryable Bilibili search failures only; HTTP 412 is retryable, but repeated failure remains a typed PROVIDER_ERROR.
- **Files changed:** mobile/src/api/http.ts, mobile/src/api/__tests__/client.test.ts
- **Why not caught:** No pre-existing provider-client regression test modeled a transient HTTP 412 followed by a valid response; type checking and linting cannot exercise that runtime error sequence.
- **Recurrence guard:** `mobile/src/api/__tests__/client.test.ts` covers a retryable Bilibili 412 followed by success and the repeated-412 terminal-error neighbor, preserving the one-retry bound and typed failure contract.
- **Verification scope:** Source-level acceptance only. Integrated Android Bilibili search through an APK, emulator, or physical device is deferred and not verified.
---
