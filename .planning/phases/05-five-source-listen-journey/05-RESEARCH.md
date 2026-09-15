# Phase 5 Research Update — Mobile Canonical Baseline

**Updated:** 2026-09-15
**Research conclusion:** the former WebView/Angular implementation premise is obsolete for Phase 5. The canonical target is the `mobile/` React Native 0.87 application with Kotlin native modules and RNTP.

## Evidence boundary

| Evidence class | What it can establish | What it cannot establish |
| --- | --- | --- |
| `mobile/` TypeScript/unit/fixture tests | deterministic contracts, reducer/controller behavior, capability projection, cancellation and safe error rendering | installed APK, API 35 behavior, live provider availability, actual system media runtime |
| Quick-task records `g8n`, `jlv`, `f3q`, `h1s`, `iuc`, `kh4` | reusable native/mobile slices listed in Context | end-to-end five-source parity or Phase-8 acceptance |
| `android/` and `app/listen1_chrome_extension/` | legacy behavior, migration pitfalls, domain vocabulary | current mobile implementation authority or permitted write target |
| API 35 emulator with live provider/system controls | Phase-8 integration evidence | a substitute for deterministic fixture/contract testing |

## What is already present

- RNTP registration and a shared player controller/service provide the correct single-owner direction for playback and remote controls.
- Search includes cancellation/epoch handling and pagination primitives; source tabs retain the required five-source order.
- Native Bilibili session, part selection, authorized audio resolution, recovery, lyric candidates, DeepSeek translation, offline boundary and MV lifecycle each have focused mobile slices.
- Discover has bounded NetEase/Kugou collection paths; Redux/player state has occurrence-aware FIFO, duplicate preservation, restoration and transaction concepts.

## Research findings that constrain planning

### A. Search/detail and capability truth

The presence of legacy desktop adapters or individual `mobile/` client methods is not enough to advertise a full source journey. Per-source restoration must distinguish search, discover, detail, playback, lyric and authentication capability. Current mobile evidence is strongest for NetEase and Bilibili; discover is bounded to its implemented sources. QQ/Kuwo/Kugou operations must be gated to their actual, approved native/API contracts instead of inherited from desktop assumptions.

Search errors need a durable request identity and visible terminal classification. Later-page cancellation/error must keep existing rows and give a retry/recovery affordance. Detail restore must preserve source/query/cursor/selected part/scroll context and suppress duplicate late append.

### B. Player/queue UI needs to meet controller semantics

The controller/RNTP direction is reusable but the player screen lacks the full user surface for seek, volume, mute and playback modes. Queue mutations must expose the existing occurrence-safe transaction model: duplicates remain unique occurrences; a failed resolve/load keeps current playback and the unconsumed FIFO entry. Device/system behavior is deliberately not inferred from this code-level evidence.

### C. Lyric correctness is identity plus accessibility

The Bilibili candidate/manual flow has useful race and persistence protections, but Phase 5 needs provider/track/part occurrence plus revision binding across automatic/manual selection, translation and offsets. General manual search/selection and offset editing require truthful capability gates. Fallback source attribution must be visible. TalkBack needs semantic original/translation/current-line/offset state, with non-noisy announcements.

## Planning implications

Future planner work should close A, B and C against `mobile/` only, reusing the listed quick-task boundaries. It must not generate code changes for legacy WebView/Angular surfaces, expose generic native transport, or treat unit passing as live/system proof. Phase 8 remains the only place to close APK/API 35/live-provider/system-runtime acceptance.
