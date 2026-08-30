# Phase 01 API-35 evidence

`phase01-api35-smoke.sh --wave0-verify` writes only a generated identity record under `android/app/build/reports/phase01/` after the platform instrumentation tracer passes. The record contains timestamp/timezone, selected emulator serial, API, ABI, WebView identity, Git SHA, APK SHA-256, command outcome, and the explicit `liveProviderVerified:false` marker.

It deliberately removes command output and never records provider bodies, URLs/query strings, headers, cookies, credentials, signed media candidates, raw exceptions, screenshots, or personal absolute paths. Delete `android/app/build/` to remove generated reports.

This Wave-0 record proves only that the packaged appassets page and typed bridge tracer ran on API 35. It is not evidence of live Bilibili availability, selected-part playback, audible progress, pause/resume, or lyrics. Those remain mandatory later live-smoke gates and must be marked `BLOCKED` or `not verified` if unavailable.
