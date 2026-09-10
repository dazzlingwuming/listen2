# Phase 5 Discussion Log

**Date:** 2026-09-10
**Mode:** Autonomous assumptions review
**User direction:** Continue without repeated discussion; implement the complete blueprint first and defer integrated APK inspection until the cohesive implementation is ready.

## Inputs reviewed

- Phase 5 goal and requirements in `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md`.
- Product and architecture constraints in `.planning/PROJECT.md` and `.planning/STATE.md`.
- Phase 4 context, UI contract, plans, review, and verification.
- Existing Android provider, typed bridge, Media3, queue, persistence, and lyric code/tests.
- Shared frontend registry, search, provider, player, queue, and lyric code/tests.
- Existing repository research for the original author's `listen1/listen1_mobile` v0.8.2 behavior contract.

## Automatically accepted assumptions

### Confident

1. Phase 5 owns one coherent five-source journey in the fixed order NetEase, Kugou, Kuwo, QQ, Bilibili; Migu/Taihe stay unavailable.
2. Bilibili and NetEase are foundations that still require full regression proof; QQ/Kugou/Kuwo have no safe Android route yet.
3. Every newly enabled capability requires its own typed, bounded native semantic route and fixture/schema contract.
4. Capability fields are enabled independently; search cannot imply directory, media, lyric, or login support.
5. Media3 remains the sole Android playback owner and unknown sources must fail closed instead of entering a Bilibili/default resolver branch.
6. Lyrics remain bound to exact provider/track/part/revision and the native Media3 clock.
7. API 35 device, system controls, renderer/process recovery, TalkBack, codec, and live-provider acceptance remain Phase-8 gates.

### Likely, accepted with required tests

1. Reuse the existing native queue, occurrence identity, snapshot, checkpoint, shuffle/repeat/history, and system-control implementation across providers.
2. Prove that reuse with mixed-provider and duplicate-occurrence fixtures before calling the five-source player contract complete.

### Unclear, resolved to the safest recommendation

1. Exact current QQ/Kugou/Kuwo network routes and session requirements are not authoritative in the legacy adapters. Resolve during phase research against current primary evidence; if no bounded authorized HTTPS route is proven, keep the affected capability false rather than weakening the bridge.
2. Live membership, region, DRM, ranking, lyric availability, and provider rate limits cannot be guaranteed by fixtures. Implement explicit terminal states now and record live verification in Phase 8.

## Stop or escalation conditions

- Stop a provider capability from being enabled if it requires cleartext, caller-supplied cookie/header, generic URL access, unknown signing material, permission/DRM bypass, or an unbounded/unstable response that cannot be normalized safely.
- Escalate only if a product decision would remove a required Phase-5 journey or materially weaken the approved security boundary. Ordinary provider unavailability is handled through the existing truthful degraded state and does not block unrelated slices.

## Outcome

The phase boundary and implementation defaults are sufficiently resolved for UI specification, technical research, planning, and autonomous execution. No further user question is required before implementation.
