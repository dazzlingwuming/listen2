# NetEase official verification and persistent session

User-approved goal: when NetEase requires verification, let the user complete the official verification and reuse the platform-issued Cookie for subsequent lyric searches. Preserve editable exact queries, direct lyric networking and playback settings. Do not claim permanent authentication; expired/revoked challenges require the user again.

1. Read-only investigation: fresh challenge URL shape, official page dependencies, existing UI/IPC mapping and Electron32 persistent session networking. Do not open or restart test apps.
2. Implement a dedicated persistent NetEase session with a sandboxed official verification window, trusted high-level IPC, Cookie retention and retry using the same session/network. No arbitrary URL/headers/cookies in renderer API, no TLS bypass, no global DNS/proxy change, no automated CAPTCHA/login.
3. Targeted contracts: official URL/domain restrictions, credential isolation, saved session reuse, cancellation/timeout, stale challenge handling and manual source retry; run scoped CI before commit/push.
4. Actual verification completion requires the user in the official window. Record unverified live Cookie recovery distinctly from mocked tests. Preserve signing setup/materials and existing application. Packaging/Release still require the already-authorized fixed identity to become usable; no ad-hoc fallback.

Current state: implementation complete, final scoped CI pending. Dedicated official session uses a bounded loopback CONNECT router with strict end-to-end TLS and NetEase-specific Google-first public DNS ordering (today’s AliDNS nodes failed TLS). Other sources retain existing anonymous transport and resolver order. Root owns integration and final acceptance; backend and UI have separate write owners. Real official verification/Cookie recovery and packaged-app acceptance remain not verified.
