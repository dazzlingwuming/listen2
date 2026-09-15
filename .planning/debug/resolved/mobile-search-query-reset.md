# Debug Session: Mobile search query resets after NetEase terminal state

## Status

resolved

## Trigger

The first fully executed API 35 integrated journey reached the NetEase search terminal state but the visible query text reset to the placeholder while the NetEase source remained selected.

## Symptoms

- Expected: after entering the search query and reaching a success/error terminal state, the search input still displays the user's query so results and provider state remain understandable.
- Actual: at stage `journey-netease-terminal`, NetEase remains selected but the input displays the placeholder; assertion detail is `query did not remain visible for 网易`.
- Candidate: releaseLike SHA-256 `b3e06e090d273bbc11a7e16e13826e5529f862844222716fa3f31865a629865b` on API 35.
- Evidence: `08-02-DERIVED-RUN-CHECKPOINT.md` and derived run `phase08-20260915T210610Z-04b84f75a3b6` contain the instrumentation stack and retained failure XML.
- Timeline: observed on 2026-09-16 Asia/Shanghai after seed, exact release install and phone-shell smoke passed.
- Reproduction: open Search, enter the fixture/query, submit/select NetEase, wait for terminal state; inspect the TextInput accessibility value.

## Constraints

- Determine whether the query is actually cleared in product state, lost by remount/key/provider switch, or only omitted from accessibility output before editing.
- Preserve provider result/error semantics; do not fake results or hard-code `青花瓷`.
- Add a component/state regression test covering query visibility across source selection and terminal success/error.
- Do not build/install APK in this debug session; Phase 08 owns the new candidate.
- Preserve unrelated acceptance evidence and user files.

## Current Focus

- Hypothesis: resolved as an acceptance-driver input failure, not a SearchScreen state reset. The current API 35 shell-text path cannot enter the fixed Chinese fixture, so search receives the initial empty query.
- Test: retained failure XML, native accessibility driver, existing resolved API 35 input evidence, and a real SearchScreen renderer test covering source change plus NetEase/Bilibili success and error terminals.
- Expecting: no product-state fix is warranted; Phase 08 must repair and verify its CJK-capable visible-input mechanism before retrying the one candidate journey.
- Next action: none — preserve the candidate/evidence and hand the driver defect to the Phase 08 owner.

## Evidence Log

- timestamp: 2026-09-16 Asia/Shanghai — Full API 35 seed/install/smoke reached IntegratedJourney once; product did not crash.
- timestamp: 2026-09-16 Asia/Shanghai — Journey failed at `journey-netease-terminal` because the visible query reset while NetEase remained selected.
- timestamp: 2026-09-16 Asia/Shanghai — `failure-window.xml` shows the TextInput's placeholder, the guide surface (`开始搜索`), and no `青花瓷`; therefore the failure occurred before any provider request or terminal reducer transition.
- timestamp: 2026-09-16 Asia/Shanghai — `AccessibilityDriver.enterText` uses `input text '青花瓷'`; the previously resolved API 35 exact-search investigation records that this shell route throws `InputShellCommand.sendText` NPE for Chinese input. The seed workflow did not assert that the entry succeeded.
- timestamp: 2026-09-16 Asia/Shanghai — SearchScreen has no TextInput key/remount path; its source selector and success/error reducers preserve the controlled query. The only explicit clear action is the labelled clear-keyword control.
- timestamp: 2026-09-16 Asia/Shanghai — Added real renderer coverage that drives TextInput and unmocked SourceTabs for NetEase and Bilibili success/error terminals. All four cases retain the typed TextInput value.

## Eliminated

- Hypothesis: a NetEase success/error terminal cleared the visible query.
  - Reason: the retained page was still the pre-request guide state, and the renderer test preserves the query through both terminal outcomes.
- Hypothesis: switching source remounted SearchScreen or cleared controlled input state.
  - Reason: SourceTabs calls the local selector without navigation; the input has no key and the real component interaction retains its `value`.
- Hypothesis: Android accessibility omitted a nonempty TextInput value.
  - Reason: the same XML exposes the placeholder as node text, which establishes the underlying field was empty rather than only inaccessible.

## Resolution

- Root cause: Phase 08's CJK shell-input route did not put the fixed query into the React Native TextInput. It calls Android `input text '青花瓷'`, a path already shown to throw `InputShellCommand.sendText` NPE on this API 35 image. The retained failure occurs before provider search.
- Fix: no product code change. Added a focused real renderer regression guard in `mobile/src/screens/__tests__/searchJourney.test.tsx` proving SearchScreen preserves user-entered text across true SourceTabs selection and NetEase/Bilibili success and error terminals. Phase 08 must replace its input injection with a safe, visible CJK-capable mechanism and assert entry immediately; it must also use the actual visible Bilibili label `哔哩哔哩`, not `Bilibili`.
- Verification:
  ```yaml
  focused_renderer:
    result: pass
    command: 'npm --prefix mobile test -- --runInBand src/screens/__tests__/searchJourney.test.tsx'
    coverage: 'NetEase and Bilibili; success and error terminals; real TextInput and SourceTabs interaction'
  full_jest:
    result: pass
    command: 'npm run mobile:test'
    suites: 53
    tests: 268
  typecheck:
    result: pass
    command: 'npm run mobile:typecheck'
  lint:
    result: pass
    command: 'npm --prefix mobile run lint -- --quiet'
  production_bundle:
    result: pass
    command: 'npx react-native bundle --platform android --dev false --entry-file index.js'
  android_jvm_and_release_like_lint:
    result: pass
    command: './gradlew --offline --no-daemon :app:test :app:lintReleaseLike'
  apk:
    result: not run
    reason: 'This debug session is not authorized to build or install a new candidate; Phase 08 owns candidate replacement and emulator acceptance.'
  ```
- Prevention: Phase 08 must make text-entry success an explicit visible assertion before submit, so a failed CJK injector cannot be misreported as a product search or provider regression.
