---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 0
total_count: 2
last_updated: 2026-09-15T07:43:39.352Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 06 | stub | mobile/src/store/librarySlice.ts |  | Legacy screen action creators are no-op compatibility actions until Phase 06-03 rewires screens to receipt-backed libraryClient commands. | open |  | 2026-09-15T07:16:50.001Z |  |
| 2 | 06 | unrun-verify | mobile/android/app/src/androidTest/java/com/listen2mobile/library/BackupTransactionInstrumentationTest.kt |  | Android instrumentation was compiled but not installed or executed; controlled execution is deferred to 06-07. | open |  | 2026-09-15T07:43:39.352Z |  |

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
  },
  {
    "id": 2,
    "kind": "unrun-verify",
    "phase": "06",
    "file": "mobile/android/app/src/androidTest/java/com/listen2mobile/library/BackupTransactionInstrumentationTest.kt",
    "line": null,
    "description": "Android instrumentation was compiled but not installed or executed; controlled execution is deferred to 06-07.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-15T07:43:39.352Z",
    "resolved_at": null
  }
]
````
