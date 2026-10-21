---
id: 261021-cr0
status: completed
date: 2026-10-21
scope: Electron desktop loudness and FX output
---

# Single-switch comfort loudness and FX repair

Implemented the approved desktop feature in `fix/desktop-comfort-loudness-20261021`, starting at diagnosis commit `5318054cf29443575594cf8d3ca7fd3304d6a4e1` (main base `5b5f90d891824cc5e339df78f3d546cb9f5d5b3e`). This summary is part of the implementation commit; final SHA and publication receipt are maintained in the authoritative task record.

## Delivered

- One persisted comfort switch in the existing settings location, both layouts and six languages; FX stays the timbre selector.
- Gated live loudness estimation, known-file initialization, bounded smooth gain and final peak protection; original/off transparency and user volume/mute preserved.
- FX level matching without the old fixed attenuation, aligned latency and smooth preset transitions.
- Safe cache/hash/version refresh and bounded transient analysis retries.
- Explicit old-node disposal/source reuse, cheap paused/empty processing and same-media seek gain retention.
- 2.35.6 macOS arm64 candidate, not installed or released.

## Validation

- Scoped `npm run test:comfort-loudness`: 39/39 pass, zero skipped, 2026-10-21 09:51:25–09:51:27 +08; final incremental resource assertions and syntax/format checks also pass. Four later formatting-only files passed Prettier AST debug comparison and a second 39/39 scoped test run (receipt 10:00:31 +08).
- 52 source-bound native offline audio renders; 16 FX/comfort combinations have at most 0.0293 LU steady difference from original on the representative input. Independent official libebur128 meter.
- Subsequent lifecycle core changes preserve all 4,608,000 compared continuous output values exactly; actual native Howler/HTML5 hub and final ASAR tests cover park/reuse/seek/mute/module loading.
- Final DMG verified, 2.35.6 arm64, source/ASAR matching, no test entries; `--publish never`. Rebuilt after formatting only; hub/core/worklet/Howler are byte-identical to the natively tested archive.

Details, source hashes, precise residuals and artifact hash: [implementation verification](../../../doc/2026-10-21/舒适音量均衡与FX修复验收.md).

## Limits and operations

No real-user song listening, loudspeaker output, Windows/x64 hardware or all-Howler-backend claim. Unknown playback boundaries need adaptation, high-crest audio may remain below target, and night FX switching retains a bounded short transient. Keyboard space activation was not established through CUA; mouse and focus/state checks passed in isolated actual-fragment previews.

The existing running app and user settings remain unchanged. No merge/tag/release/install action was taken. Temporary artifacts are managed by the registered task workspace; accepted report/installer are independent of its runtime.
