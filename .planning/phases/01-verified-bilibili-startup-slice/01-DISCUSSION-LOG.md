# Phase 1: Verified Bilibili Startup Slice - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents. Decisions are captured in CONTEXT.md; this log preserves the alternatives considered.

**Date:** 2026-08-30
**Phase:** 01-verified-bilibili-startup-slice
**Areas discussed:** Bridge contract, Bilibili selection and authorization, foreground playback and lyric entry, home and failure UX, emulator evidence

---

## Bridge contract

| Option | Description | Selected |
|--------|-------------|----------|
| Operation-based v2 RPC | Native constructs approved provider requests from typed params; request id, epoch, cancellation, structured errors | ✓ |
| Expand raw URL allow-list | Keep exposing URL-shaped GET and add more routes | |
| General local proxy | Proxy arbitrary requests through native or localhost | |

**User's choice:** Auto-selected the recommended operation-based v2 RPC under the approved autonomous workflow.
**Notes:** Keep v1 only for temporary compatibility; never add a general proxy or caller-controlled headers/cookies.

---

## Bilibili selection and authorization

| Option | Description | Selected |
|--------|-------------|----------|
| Exact CID with explicit first-page default | Anonymous public access; an unqualified BVID may choose the real first page, an explicit missing CID fails | ✓ |
| Always first-page fallback | Play the first page whenever CID lookup fails | |
| Require login first | Block Phase 1 playback on persistent login | |

**User's choice:** Auto-selected exact part identity and anonymous public playback.
**Notes:** Persistent auth is Phase 5; actual entitlement is never bypassed.

---

## Foreground playback and lyric entry

| Option | Description | Selected |
|--------|-------------|----------|
| Bounded foreground proof | Use existing Howler only for audible Phase 1 proof; Media3 replaces ownership in Phase 2 | ✓ |
| Pull Media3 forward | Implement service, queue, notification, and foreground slice together | |
| URL-only proof | Treat successful media resolution as playback success | |

**User's choice:** Auto-selected the bounded foreground proof.
**Notes:** Playback must advance beyond 0:00. The lyric UI must terminate truthfully; full synchronization remains Phase 3.

---

## Home and failure UX

| Option | Description | Selected |
|--------|-------------|----------|
| Local-first shell plus bounded remote loading | Show usable navigation immediately, finalize every request, preserve partial success, and offer retry | ✓ |
| Block home on default provider | Keep the spinner until remote catalog succeeds | |
| Hide failing providers | Remove all source controls after a failure | |

**User's choice:** Auto-selected local-first startup and bounded remote loading.
**Notes:** Unsupported startup auth probes are skipped; empty results and network/provider failures remain distinct.

---

## Emulator evidence

| Option | Description | Selected |
|--------|-------------|----------|
| Fixtures plus live emulator smoke | Deterministic contracts plus timestamped anonymous public Bilibili playback on API 35 | ✓ |
| Fixtures only | Never exercise real WebView/provider/audio behavior | |
| Manual visual inspection only | Screenshots without deterministic failure tests | |

**User's choice:** Auto-selected fixtures plus live emulator evidence.
**Notes:** Build/JVM/static tests alone do not complete the phase. Evidence is redacted and records exact APK/git/device inputs.

## the agent's Discretion

- Internal class and operation names, fixture organization, localized wording, and the narrow v1 compatibility implementation.

## Deferred Ideas

- Media3/background controls (Phase 2), full lyrics (Phase 3), persistent auth (Phase 5), cache/offline (Phase 8), and MV/effects/AI (Phase 9).
