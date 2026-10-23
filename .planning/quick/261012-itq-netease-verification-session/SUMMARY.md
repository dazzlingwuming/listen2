# Official NetEase lyric verification session

Implemented the user-approved official verification flow and native persistent Cookie reuse. NetEase APIs and the sandboxed official window share one dedicated Electron session, user agent and bounded CONNECT route. Challenge URLs stay in main-process memory, trusted IPC accepts no URL or Cookie, and closing the window retries the unchanged current query without claiming verification success.

NetEase alone uses Google-first among the fixed public resolvers based on today’s TLS evidence; anonymous sources retain AliDNS-first. TLS is end-to-end, with no certificate bypass or system network change. Cookies retain the platform’s actual expiration semantics.

Local CI PASS, 2026-10-12 13:50–13:51 CST, macOS/Node24.15.0, branch agent/kugou-lyrics-20261012, starting HEAD30f13a9254a7d18d6f076d776c7b2de9317e7aec. Six targeted Node test files: 70/70. New frontend verification, existing DeepSeek UI/cache renderer and translation IPC contracts passed. Related JS formatting/syntax, six locale JSON contracts and diff checks passed. No full suite or GUI app started. Existing whole-HTML formatting drift remains unchanged.

Not verified: live challenge resource completeness, real user verification/Cookie acceptance, persisted session after app restart, packaged UI. No new installer or Release: fixed signing OS trust remains pending. Roll back this feature by reverting its commit; installed app and user data were not changed.
