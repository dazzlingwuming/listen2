# Phase 8 Prerequisite Truth

## Planning-Time Snapshot

Phase 8 prerequisite planning is complete. Execution may begin once the current clean worktree and report-reachability script confirms the table below.

| Phase | Evidence currently present | Planning-time truth | Required before `08-01` |
|---|---|---|---|
| 4 | 3 summaries; verification `passed`; review `clean` | Ready subject to current-HEAD reachability | Preserve accurate `3/3` ROADMAP status and prove recorded product commits are ancestors of current HEAD. |
| 5 | 5 summaries; verification `complete`; review `clean`; ROADMAP now `5/5` | Deterministic implementation ready; Phase 8 external/device evidence remains intentionally pending | Preserve the declared Phase 8 live-provider boundary and prove recorded product commits are ancestors of current HEAD. |
| 6 | 7 summaries; verification `passed`; review `clean`; ROADMAP now `7/7` | Deterministic implementation ready; Phase 8 live/system evidence remains intentionally pending | Bind verification/review product SHA and referenced paths to current HEAD reachability. |
| 7 | 5 summaries; review `clean`; deterministic verification `passed` at reachable product HEAD `17da1fe` | Deterministic implementation ready; Phase 8 device/live evidence remains intentionally pending | Require the prerequisite script to confirm both reports, all product commits and current HEAD reachability before building. |

`08-01` creates `mobile/scripts/acceptance/verify-phase8-prerequisites.mjs`. It must fail before npm/Gradle/build work unless all Phase 4–7 plan/SUMMARY inventories match, ROADMAP counts/checkmarks are truthful, every phase-assigned requirement ID is still present, every implementation commit is reachable from current HEAD, Phase 4–7 reviews are `clean`, Phase 4/6/7 verifications are `passed`, Phase 5 is `complete`, and Phase 7 has no remaining gap/finding. Phase 7 review and verification must name the same current/reachable product HEAD; a missing report is `BLOCKED`. Final per-requirement completion is decided only by the Phase 8 58-row current-HEAD evidence map, not by stale Markdown checkboxes. The result is written inside the new run directory as `08-prerequisites.json`; it never edits planning truth automatically.

External API 35/account/provider evidence intentionally remains Phase 8 work and is not required to turn Phase 5 deterministic verification into a prerequisite pass.
