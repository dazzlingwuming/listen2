---
status: complete
---
# DeepSeek response reliability repair

Base: GitHub origin/main b981a444. Code: c9ce651. Branch: fix/deepseek-response-reliability-20261019. User approved repair/build and confirmed the installed application now works.

## Verified failure and change

Native Electron requests reproduced HTTP200 + finish stop with malformed JSON (placeholder token or zero-width formatting), then 50-line translation reproduced complete IDs plus an extra type key. Proxy routing alone did not resolve it. Fixed canonical model, exact real-ID flat output contract (prompt v3), one bounded corrective retry, conservative formatting normalization, strict alignment/sentinel rejection, bounded response reading and safe operation-specific errors. Fixed settings test pending race; translation deadline120s, test30s. Existing dirty Android worktree untouched.

## Validation

- Scoped CI PASS 2026-10-19 16:29:08–16:29:09 Asia/Shanghai: npm run test:machine-translation (IPC + response suite); frontend DeepSeek UI contract; node syntax; scoped Prettier; git diff --check. Earlier JSON/front-end formatting checks passed. Main legacy mixed line endings preserved. No Docker or unrelated whole-repository gate used.
- Native Electron32 live: initial system50 passed, then direct/system each test+50-line lyric passed; final post-review repeat also passed all4, each1attempt. Each translation had50 time tags and50 Chinese lines, using existing saved style. Packaged ASAR source also passed live test+50-line translation.
- DMG built ARM64, hdiutil verify VALID. Packaged source equals c9ce651; no root .env/task docs/runtime or actual credential in ASAR. A first overbroad private-path check matched legitimate ajv dependency runtime directories; corrected to project-root runtime path, then passed.
- Installed repair to /Applications/Listen1.app after UI Quit; old app retained for rollback. Observed Because You Live and Apologize completed notices and bilingual lyrics. User: “现在可以使用了。”

## Delivery and recovery

Artifact: original repository dist/deepseek-repair-main-20261019/listen1_2.35.4_deepseek_fixed_mac_arm64.dmg (100805792 bytes).
SHA256: 365f1e2f80d91445265e4e144410f10f7c9675ed6457c01270da2e8d10455471.
Rollback app: outer workspace rollback/Listen1.app. Retained intentionally for recovery; no credential copied. Registered runtime tools/profiles removed after verification through task_workspace.py complete.

Source branch pushed, not merged. No release published. No formal signing/notarization. Exact 7 Years source not captured; functional acceptance uses native synthetic50 and observed installed real-song success plus user confirmation. Low-level direct-network anomaly/first401 cause remains unknown; do not claim DNS/ISP cause. Original task record remains under original repository doc/2026-10-19/DeepSeek翻译不完整-2026-10-19至2026-10-19.md.
