# API / Semantic Operation Coverage — Phase 4

No external API integration: Phase 4 creates the phone shell and semantic capability registry only; live provider routes and media behavior belong to Phase 5.

| Semantic operation | Phase 4 lifecycle coverage | Phase 4 live-route change | Missing-route terminal |
|---|---|---|---|
| `search` | Exact bounded request/response, deadline, cancel, page destroy, stale epoch, duplicate/late reply, exactly-once settlement; the shell consumes the existing `MediaService.search` seam | None — no provider endpoint or native RPC operation is added | `unavailable` before dispatch |
| `directory` | Same provider-route-free lifecycle contract, exercised with a fake executor only | None | `unavailable` before dispatch |
| `media` | Same provider-route-free lifecycle contract, exercised with a fake executor only; Media3 remains playback owner | None | `unavailable` before dispatch |
| `lyric` | Same provider-route-free lifecycle contract, exercised with a fake executor only | None | `unavailable` before dispatch |
| `login` | Same provider-route-free lifecycle contract, exercised with a fake executor only; no credential material enters the registry | None | `unavailable` before dispatch |

All semantic requests and terminals use fixed operation/source/request/page-epoch identities and exact allow-listed fields. The contract rejects arbitrary URLs, headers, cookies, tokens, signed media candidates, local paths, native objects, raw errors, and unknown operations. It does not broaden the native RPC v2 operation or terminal enums.
