# Phase 5 Coverage Baseline — Corrected to `mobile/`

**Status:** planning baseline; no row is an APK/API-35/live-provider completion claim.

## Source capability posture

| Source | Current reusable evidence | Phase-5 truth posture |
| --- | --- | --- |
| NetEase | bounded search/playlist/media/lyric flows and `jlv` Discover foundation | retain only operation-level capabilities proved by mobile contracts; device/live behavior deferred to Phase 8 |
| Kugou | bounded discover foundation and some mobile client paths | do not infer complete search/detail/playback/lyrics from discovery or legacy code; gate each operation |
| Kuwo | limited mobile client/search evidence | unavailable unless a bounded approved mobile route, schema and tests establish the exact operation |
| QQ | limited mobile search/lyric evidence | do not advertise playback/discover/detail from legacy assumptions; gate exact verified operations |
| Bilibili | `f3q` session/audio/parts, `iuc` lyrics, `kh4` MV paths | reusable foundation with truthful login/media/lyric/MV degradation; live provider/system proof remains Phase 8 |

Migu and Taihe remain outside this five-source mobile journey and are not substitute tabs or fabricated empty states.

## Baseline and gap map

| Area | Confirmed mobile baseline | Remaining Phase-5 closure |
| --- | --- | --- |
| Offline | `g8n` bounded download/cache-first boundary | keep capability/provider limits visible; do not turn cached proof into all-source offline claim |
| Discover | `jlv` bounded NetEase/Kugou collections/navigation | restore only per-source detail/discover paths with approved capabilities and resilient state restoration |
| Bilibili auth/audio | `f3q` QR/account/parts/native resolution/recovery | integrate search/detail UI errors and capability truth without leaking session/media data |
| Translation | `h1s` consented DeepSeek boundary/cache identity | maintain lyric identity/revision and user-visible provenance/error state |
| Lyrics | `iuc` candidate/manual/race/persistence path | occurrence/revision-wide manual/offset/provenance and TalkBack semantics |
| MV | `kh4` native MV lifecycle | capability-gated integration and audio-safe degradation |
| Search/detail | cancellation/epoch/pagination primitives | **A:** per-source restoration, real detail capabilities, actionable error states and no false success/no-result conversion |
| Player/queue | RNTP/controller and occurrence/FIFO transaction primitives | **B:** exposed seek/volume/mute/mode controls and occurrence-safe queue UI/mutations/restoration |
| Lyric UX | LRC/candidate/translation foundations | **C:** occurrence/revision binding, manual/offset controls, visible provenance and TalkBack-safe semantics |

## Acceptance partition

Phase 5 may establish deterministic mobile contract coverage for A/B/C. It does not close integrated runtime acceptance. Phase 8 owns the installed APK, API 35 emulator, live provider/API behavior, actual authorized media/codec behavior, notification/lock-screen/audio-focus/headset/Bluetooth, background/restart/process lifecycle, real TalkBack/IME/rotation and performance evidence.

## Historical traceability

`legacy-webview-plans/05-01-PLAN.md` through `legacy-webview-plans/05-09-PLAN.md` are retained unchanged to explain the prior WebView/Angular baseline. They are not current plans and do not authorize writes outside `mobile/`.
