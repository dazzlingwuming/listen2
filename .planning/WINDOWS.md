---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-09-15T07:16:50.001Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 06 | stub | mobile/src/store/librarySlice.ts |  | Legacy screen action creators are no-op compatibility actions until Phase 06-03 rewires screens to receipt-backed libraryClient commands. | open |  | 2026-09-15T07:16:50.001Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "06",
    "file": "mobile/src/store/librarySlice.ts",
    "line": null,
    "description": "Legacy screen action creators are no-op compatibility actions until Phase 06-03 rewires screens to receipt-backed libraryClient commands.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-15T07:16:50.001Z",
    "resolved_at": null
  }
]
````
