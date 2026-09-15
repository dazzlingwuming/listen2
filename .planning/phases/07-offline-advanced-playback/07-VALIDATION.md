# Phase 7 Validation Strategy and Source Audit

## Execution Strategy

Per D-02 and D-10, implement the complete Phase 7 functional surface using focused checks after each plan. Do not generate an APK or start an emulator per plan. After all Phase 7 plans are integrated, run the repository-defined source/JVM/Jest gates once. Phase 8 owns APK assembly/signing and API-35 emulator/live/device acceptance.

The commands below are intended to stay under one minute per focused invocation where practical. Executors may narrow a Jest invocation further while iterating, but each plan summary must record the exact final commands and results.

## Focused Gates by Plan

| Plan | Focused automated evidence |
|---|---|
| 07-01 | Only newly added selectors: native `MediaDescriptorContractTest`, `FiveSourceMediaDescriptorContractTest`, `BilibiliRenditionEntitlementTest`; Jest `mediaDescriptorMigration.test.ts` |
| 07-02 | Only newly added selectors: native `OfflineCatalogMigrationTest`, `OfflineRecoveryContractTest`; Jest `cacheLibrary.test.tsx` and `offlineLegacyChainRemoval.test.ts` |
| 07-03 | Only newly added selectors: native `AudioEffectsContractTest`, `LoudnessAnalyzerTest`; Jest `audioEffectsFlow.test.tsx` |
| 07-04 | Only newly added selectors: native `DeepSeekPrivacyContractTest`; Jest `deepSeekRevisionLifecycle.test.tsx` and `deepSeekSettingsStatus.test.tsx` |
| 07-05 | Phase security/entitlement matrix, secret/artifact/backup scanners, then `cd mobile && npm test -- --runInBand` and `cd mobile && ./node_modules/.bin/tsc --noEmit` |

If a named test file does not exist at execution start, the owning plan creates it before production behavior and its focused command is the Nyquist gate. Executors must use the existing repository JDK-17 Android test helper or the exact Gradle JVM unit-test command recorded by prior mobile plans; no APK task is part of these Phase 7 checks.

## Deterministic Fixture Matrix

### Media/entitlement fixtures

- Bilibili authorized anonymous/account/member qualities, multiple parts, expired WBI/signed lease, CDN primary failure then bounded candidate success, region/member/DRM denial.
- QQ, Kuwo, NetEase, and Kugou permitted media plus login/region/provider failure normalization.
- Forged part/rendition, account-generation mismatch, expired lease, wrong MIME/container/codec/length, too many CDN candidates, redirect outside allow-list.

### Cache fixtures

- Owner transitions: playback -> temporary; playlist association -> playlist owner; explicit action/promotion -> explicit; shared blob survives one-owner removal.
- Resume: valid 206 Content-Range/validator continuation; ignored Range restarts safely; changed ETag/revision discards partial; cancellation and process recreation never publish partial.
- Integrity: length mismatch, hash mismatch, unsupported signature/codec, provider-open failure, missing blob, orphan partial, orphan row, duplicate attempt.
- Quota: 2 GB default; exact 1/5/10 GB; `null` unlimited; concurrent reservation; LRU order; explicit never selected; disk-full bounded repair.
- Entitlement: allowed at acquire but denied at play/login; stale lease refresh; offline allowed only for complete entry with current authority.

### Effects/visualizer fixtures

- No player session, actual session created/replaced/released, effect constructor failure, control lost, invalid preset, headset/Bluetooth route transition.
- Visualization permission granted/denied, foreground/background, pause/seek/track generation, low-end/unsupported capability, bounded frame size/rate, stale frame rejection.
- In every failure case playback continues with neutral/original audio.

### Loudness fixtures

- Published reference PCM vectors with known silence/tone/program-like integrated loudness and peak tolerances.
- Target gain toward -14 LUFS clamped to -1 dBTP; NaN/short/corrupt/decoder-failure yields unity.
- Matching hash/sample-rate/codec/analyzer version reuses; any changed component invalidates.
- First play returns immediately without a result and schedules only complete eligible media.

### DeepSeek fixtures

- Keystore create/encrypt/decrypt unavailable/corrupt paths never write plaintext and expose only safe status.
- Cancel before consent and cancel during request produce zero cache writes; no consent produces zero network calls.
- Valid schema/exact line order/timeline/revision persists; missing/extra/reordered/misaligned/truncated/oversized response does not.
- Error/log/snapshot/backup/artifact scans include marker secrets and lyric/model canaries and prove absence.

## Phase 8 Acceptance Handoff

Phase 8 must consume the deterministic fixtures and add evidence for one integrated build: API-35 install/start, live account/provider/CDN checks where credentials are supplied out of repo, Doze/process death/network switching, real device/emulator codec and route capability, effect/Visualizer permission and audio preservation, loudness background completion, MV part/quality/full-screen/PiP, backup extraction/restore, APK secret scan, and measured performance. Phase 7 summaries must state any environment-limited item as `not verified`, not as passing.

## Multi-Source Coverage Audit

### Goal coverage

| Goal item | Coverage |
|---|---|
| Authorized media remains available offline with recoverable states | 07-01, 07-02 |
| Advanced playback is real Android behavior or an honest actionable equivalent | 07-01, 07-03 |
| Protected, consented, valid DeepSeek translation | 07-04, 07-05 |
| Integrated device proof | Phase 8 by D-10; Phase 7 produces the handoff contracts |

### Requirement coverage

| Requirement | Plans | Observable proof |
|---|---|---|
| PLAY-002 | 07-01, 07-05 | Native descriptor, real rendition/part choices, bounded CDN and entitlement matrix |
| CACHE-001 | 07-02 | Owner/catalog/integrity/readability tests |
| CACHE-002 | 07-02, 07-05 | Resume/cancel/repair/restart/expiry/current-authority tests |
| CACHE-003 | 07-02 | Nullable quota and explicit-safe LRU tests |
| CACHE-004 | 07-02, 07-05 | Work constraints, cache library actions, disk/backup/log checks |
| FX-001 | 07-03, 07-05 | Actual-session preset lifecycle and audio-preservation tests |
| FX-002 | 07-03, 07-05 | Real frames/synchronization/labelled fallback tests |
| FX-003 | 07-03, 07-05 | Reference vectors, identity invalidation, unity fallback tests |
| AI-001 | 07-04, 07-05 | Keystore-only configure/test/clear and no-echo tests |
| AI-002 | 07-04 | Consent/no-call/cancel tests |
| AI-003 | 07-04, 07-05 | Native validation/cache and canary absence scans |
| SEC-004 | 07-01, 07-02, 07-04, 07-05 | Native-private transport/secret boundaries plus final entitlement/artifact audit |

### Research constraint coverage

| Research item | Coverage |
|---|---|
| Provider-neutral native descriptor and ephemeral lease | 07-01 |
| Room-authoritative owner catalog and WorkManager acquisition | 07-02 |
| Searchable cache library and nullable quota contract | 07-02 |
| Actual-session effects and permission-gated real analyzer | 07-03 |
| Complete-media asynchronous loudness analysis | 07-03 |
| Keystore fail-closed/native-private DeepSeek transaction | 07-04 |
| No secret/media/URL backup or artifacts; cross-feature entitlement | 07-05 |

### Context decision coverage

| Decision | Coverage |
|---|---|
| D-01 | Every plan file list and action is restricted to `mobile/` |
| D-02 | Every plan uses focused checks; this validation file prohibits per-plan APK/emulator loops |
| D-03 | 07-02 |
| D-04 | 07-01, 07-02, 07-05 |
| D-05 | 07-02 |
| D-06 | 07-01 |
| D-07 | 07-03 |
| D-08 | 07-03 |
| D-09 | 07-04, 07-05 |
| D-10 | Every plan verification section and Phase 8 handoff |

Audit result: all roadmap goals, all 12 Phase 7 requirement IDs, all in-scope research constraints, and all locked decisions are covered. No deferred idea is planned.
