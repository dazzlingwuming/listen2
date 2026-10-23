---
status: verifying
created: 2026-10-12
updated: 2026-10-12
---

# macOS Keychain prompts after updates

User confirmed the prompt concerns Listen1 Safe Storage, not Finder install permissions.
Complete ad-hoc signing produces content-dependent cdhash designated requirements; today's two builds differ. Electron documents repeated Keychain consent with inconsistent identities. Previous unsigned/incomplete package is not a safe rollback.

Fix implemented: public translation/auth metadata reads cached availability (null until actual secret use), removing unconditional Keychain probes. Actual encryption/decryption retains availability checks and no plaintext fallback. Logged-in Bilibili refresh and first actual credential use can still require consent after a changed ad-hoc build. Cookie encryption fuse is disabled; no fuse or trust-setting changes made.

Scoped local tests passed; actual update/Keychain UI acceptance remains not verified. Do not run another GUI instance, approve system prompts, weaken requirements or install trust roots. An isolated self-signing experiment failed trust validation and was cleaned up; user keychain search list unchanged.

Next: user chooses lyrics egress route, then combine approved verified changes into a package and validate through their existing application at their chosen update time. Overall lyrics recovery remains degraded, not complete.

- Fixed certificate setup code prepared; current-user codeSign trust twice timed out, still zero valid identities. Root requests user OS-window status, no SecurityAgent automation. Package/repeated-update UAT blocked pending that step. Lyric fix e27be1d pushed; no new DMG/Release.
