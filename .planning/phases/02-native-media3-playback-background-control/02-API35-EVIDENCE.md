# Phase 02 API-35 deterministic evidence

## Result

**Status:** PASS (deterministic gate only)
**Timestamp:** 2026-08-31T05:40:09+0800

## Identity

- Git SHA: 9affb51901d42b385eb835bd0654ca10ceb939b0
- APK SHA-256: b6b774d696b32b225fb4bb0533659a53b28566056036c05d797ed0a7cd61598f
- Package: com.dazzlingwuming.listen2.debug
- Build variant: debug
- API: 35
- ABI: arm64-v8a
- AVD: listen2_api35
- WebView:   Current WebView package (name_ version)_ (com.google.android.webview_ 124.0.6367.219)

## Deterministic API-35 markers

- installed-service-session: PASS
- page-and-ui-boundary: PASS
- system-notification-controls: PASS
- room-semantic-checkpoint: PASS
- process-death-stage-a: PASS
- process-death-empty-pid: PASS
- process-death-relaunch: PASS
- process-death-stage-b: PASS
- no-transport-material: PASS

## Bounded recovery observations

- checkpoint-revision: monotonic and restored
- current-occurrence: duplicate-safe semantic identifier asserted by installed test
- queue-order-count: exact duplicate FIFO asserted by installed test
- mode-history: shuffle mode and cursor/depth asserted by installed test
- position: restored paused position is within 5 seconds
- force-stop: PID empty before relaunch
- relaunch-reconnect: explicit debug Activity and Stage-B controller reconnect passed
- transport-scan: snapshot/evidence accepts no transient playback material

## Screenshots

- evidence/02-player.png: first redacted packaged-page context capture after clean app launch
- evidence/02-queue.png: second distinct redacted packaged-page context capture after clean app launch
- evidence/02-notification.png: third distinct redacted packaged-page context capture after clean app launch
- Screenshot scope: redacted host/page context only; installed instrumentation is the semantic service/queue/notification proof.

## System surface coverage

- page/session/control: PASS via PlaybackServiceInstrumentationTest and Phase01WebViewInstrumentationTest
- notification/focus/noisy/screen-off: PASS via PlaybackSystemControlsInstrumentationTest
- Bluetooth/AVRCP: not verified — API-35 emulator has no real Bluetooth/AVRCP transport

## Live provider gate

- live-provider-media3: BLOCKED — Phase 1 HTTP 412
- Overall Phase 2: not verified; deterministic fixture/build/JVM output cannot satisfy live playback.

## Reproduction

- Commands: exact debug APK build/signature, installed connected classes, phase02-process-death-smoke.sh --verify, clean-launch CDP capture
- Recovery: restore a supported API-35 emulator and rerun --run-deterministic; run strict verification only after 02-10 live PASS.
