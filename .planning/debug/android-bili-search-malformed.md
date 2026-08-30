# Debug Session: Android Bilibili Search Malformed

## Status

 resolved

## Trigger

On the API 35 Android emulator, the rebuilt app cannot return Bilibili search results; the provider finishes in the safe terminal `error/malformed` state.

## Symptoms

- Expected: a cold-launched exact APK can perform an anonymous public Bilibili search and render source-labelled results that expose a selectable BVID/CID path.
- Actual: the search request completes without usable rows and is classified as `error/malformed`.
- Errors: no raw exception or provider payload was retained by the fail-closed evidence harness.
- Timeline: reproduced on 2026-08-31 after commits through `0608898` on `agent/android-mobile-rebuild`.
- Reproduction: build/install the debug APK on `emulator-5554` (API 35), clear/cold-launch, enter a bounded query, and activate the Bilibili provider.

## Environment

- Repository: `/Users/fluenteng/个人相关/listen1/listen1_desktop`
- Emulator: `emulator-5554`, API 35, arm64-v8a
- Package: `com.dazzlingwuming.listen2.debug`
- WebView: `com.google.android.webview 124.0.6367.219`
- Evidence: `.planning/phases/01-verified-bilibili-startup-slice/01-API35-EVIDENCE.md`

## Constraints

- Preserve fail-closed behavior and do not substitute fixtures, cached results, or a known BVID for the live gate.
- Do not log or retain credentials, cookies, authorization headers, or full provider payloads.
- Preserve unrelated working-tree changes and the current evidence directory.
- Do not commit or push; the root agent owns CI, commit, and push.

## Current Focus

- Hypothesis: confirmed. The typed search projector rejected an entire otherwise valid response
  when it encountered provider-owned rows without playable identities.
- Next action: the Phase-01 executor must rebuild from this working tree and rerun the complete
  live provider → exact part → foreground audio → lyric gate before replacing the preserved
  blocked evidence.

## Evidence Log

- `01-API35-EVIDENCE.md` records the exact APK identity and failed live journey at SHA `0608898`.
- Reproduced on API 35 after a cleared cold launch using native touch input: the visible mobile
  search state settled at `error` with the existing safe malformed-response message.
- A bounded, no-payload-shape inspection of the current anonymous public response found a
  successful provider envelope with mixed rows: playable video rows plus rows without a usable
  BVID. No response body, cookie, header, token, or URL was retained.
- After the row-level projection fix, a rebuilt and signature-verified debug APK on the same
  API-35 emulator reached `content` from the same native touch path with 17 selectable video rows.

## Resolution

### Root cause

`AndroidRpcContract.projectSearchResponse` treated every item in a current public Bilibili search
page as if it were a directly playable video. Provider-owned non-video/promotion rows have no
usable BVID, so a single such row failed the entire otherwise valid page as malformed.

### Fix

Project only independently valid, directly playable rows; discard each invalid/non-video row
without exposing it to JavaScript. A non-empty provider page with no safe video rows remains a
fail-closed malformed response. `AndroidRpcContractTest` covers mixed safe and non-video rows.

### Verification

- Focused JVM contract test: PASS.
- API-35 cold-launch/native-touch search: PASS (safe content state with selectable rows).
- Full Phase-01 public provider → part → audio → lyric journey: pending rerun by the phase
  executor; the prior blocked evidence is intentionally preserved until that exact full gate passes.
