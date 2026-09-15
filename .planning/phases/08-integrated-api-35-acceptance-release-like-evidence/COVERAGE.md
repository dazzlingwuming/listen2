# Phase 8 External/API Coverage Matrix

**Status:** integrated-acceptance contract. `INTEGRATE` means the production route is exercised and reported; it does not mean a live call has passed before execution. Every live failure remains `DEGRADED`, `NOT_VERIFIED`, `BLOCKED`, or `FAIL` in Phase 8 evidence.

| capability | decision | reason |
|---|---|---|
| `netease.search-detail-play-lyrics-offline` | INTEGRATE | Public fixed-query and semantic-track journey on the exact release-like APK; no raw URL/header evidence. |
| `kugou.search-detail-play-lyrics-offline` | INTEGRATE | Production capability must reach success or an exact actionable terminal state; unproved operations do not become empty success. |
| `kuwo.search-detail-play-lyrics` | INTEGRATE | Native fixed-cookie/Secret boundary stays private; missing account/provider availability is independently non-pass. |
| `qq.search-detail-play-lyrics` | INTEGRATE | Cookie-free semantic native resolver only; entitlement/CDN absence is independently non-pass. |
| `bilibili.search-parts-renditions-audio-lyrics-mv-auth` | INTEGRATE | Anonymous paths are attempted; the runner has no credential channel, and secure visible in-app entry is required or auth remains `NOT_VERIFIED`; QR/session material is never retained. |
| `deepseek.vault-consent-translate-cache` | INTEGRATE | No-key/cancel is deterministic; the runner rejects CLI/environment/file key input, so live translate is `NOT_VERIFIED` without separate authorized visible in-app secure entry. |
| `android.saf-local-media-lrc-repair` | INTEGRATE | Generated audio/LRC only; no broad storage permission or user media retention. |
| `android.rntp-media-session-background-recovery` | INTEGRATE | System state and advancing position must match the app snapshot and one player owner. |
| `android.room-datastore-keystore-workmanager` | INTEGRATE | Real release-like process/storage paths and existing instrumentation; no destructive fallback. |
| `android.external-navigation-policy` | INTEGRATE | Production policy only; approved HTTPS exits and unsafe schemes remain rejected. |
| `migu.provider-routes` | OPT-OUT | Phase 4 keeps Migu explicitly unavailable until a bounded route and device proof exist; it cannot appear as a working tab. |
| `taihe.provider-routes` | OPT-OUT | Phase 4 keeps Taihe explicitly unavailable until a bounded route and device proof exist; it cannot appear as a working tab. |
| `legacy-webview-android-runtime` | OPT-OUT | Historical reference is not the canonical product and must not enter the APK. |
| `electron-desktop-runtime` | OPT-OUT | Android uses native mobile equivalents; desktop IPC/windows/tray code cannot be packaged or invoked. |
| `caller-controlled-transport` | OPT-OUT | Arbitrary URL/header/cookie/redirect/media authority is forbidden and scanned from APK/state/evidence. |

The matrix is complete for Phase 8: every external or Android system surface is either exercised through its production contract or explicitly excluded with a project decision and observable unavailable/equivalent behavior.
