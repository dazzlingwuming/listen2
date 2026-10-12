---
status: complete
---
# Persistent macOS signing setup

Updated 2026-10-12 14:01 CST. Fixed identity established in the repository-external owner-only dedicated keychain; the user confirmed current-user codeSign-only trust. No TLS/admin/System/login trust or credential contents changed.

Recovery confirmed codesign needs the dedicated keychain in the user search list despite --keychain. Scoped helpers now save/append/finally-restore and verify the original ordered list, serialize asynchronous sign hooks, and fail if restoration fails. This serialization is within one Node process; independent builds must not overlap, and forced process termination can prevent finally cleanup. The designated requirement is read from both output streams.

Actual setup passed: two changed tiny apps strictly verified and retained the same certificate-based designated requirement; rerun returned reused=true/stable=true. User search list restored to its original login-only value. Identity materials were reused, not regenerated.

Targeted CI PASS: 11 signing tests, three JS syntax/Prettier checks and diff check, macOS/Node24.15.0, starting HEAD709375d, task-only changes. No full suite. Root owns commit/push and package/Release validation.

Not verified: actual Safe Storage ACL migration and subsequent installed updates. Fixed signing is a selected repair, not a requirement for every possible Listen1 installation; historical absence of prompts is not fully reconstructed. No Apple Developer ID/notarization is provided. Existing installed app has not been launched or replaced.

Recovery: retain the fixed signing directory. If a build is force-killed, check the user search list against the pre-build value before another build. Certificate trust can be removed explicitly with security remove-trusted-cert using its repository-external certificate.pem; do not destroy the identity to mask errors.
