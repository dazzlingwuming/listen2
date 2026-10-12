---
status: approved
---
# Fixed local macOS signing identity

Approved user scope (2026-10-12): establish a persistent, free self-signed code-signing identity and current-user codeSign-only certificate trust. No TLS/admin/System/login keychain trust, credential argv/output, Listen1 launch, merge, publication, or weakening secret storage.

Ownership: build/macosSign.js, build/setupMacSigning.js, app/test/macosSigning.test.js, README signing subsection; this separate quick directory. Preserve all other workers' edits. Parent maintains task diary and owns final commit/push/build.

1. Create idempotent setup using a 10-year CA:false codeSigning certificate, a repository-external 0700 signing directory, dedicated keychain and 0600 secret files. Security.framework helper receives passwords over stdin. Existing material must be reused, never silently regenerated.
2. Apply only approved current-user codeSign trust to the newly created certificate. Verify two changed tiny apps have identical default DR and pass strict static verification. Stop for any required user interaction; never approve OS prompts.
3. Make signing hook discover the local configuration, reuse its fixed SHA1/keychain, and fail closed when configured identity is invalid. Retain explicit ad-hoc compatibility on unconfigured hosts.
4. Run signing-related tests, syntax/format checks, document coverage and rollback, then hand off. Real Safe Storage authorization and cross-update app UAT remain unverified.
