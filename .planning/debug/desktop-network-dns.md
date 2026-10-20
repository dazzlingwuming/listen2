---
status: investigating
trigger: "桌面版搜索得到歌曲但很多歌曲点击播放失败，歌词搜索偶发无结果，用户怀疑DNS、代理或公司网络。"
created: 2026-10-20
updated: 2026-10-20
goal: find_root_cause_only
---

## Task record

Authoritative continuity record: `doc/2026-10-20/桌面播放与歌词网络诊断-2026-10-20至2026-10-20.md`.

## Symptoms

- Desktop application, not Android. Search metadata can succeed while playback fails.
- Many tracks affected; QQ/NetEase/Kugou mentioned, but whether they are playback sources or lyric sources is awaiting clarification.
- Lyrics intermittently return no candidates. Proxy is enabled.

## Current Focus

hypothesis: More than one failure is possible: intercepted/Fake-IP network path, TLS reset, provider verification or permissions, and separate direct lyric transport.
next_action: Read a concrete original playback failure and inspect the actual proxy client rules if the user proceeds with repair; read the task record and report before resuming.
reasoning_checkpoint: Analysis delivered. Direct mode with default Fake-IP DNS still fails NetEase/Kugou, while identical direct Chromium requests with public host mappings succeed. This supports a Fake-IP/TUN path problem, without identifying the internal rule or original audio CDN failure. QQ public-IP connections still reset; LRCLIB works.

## Evidence

- timestamp: 2026-10-20
  source: installed ASAR/process inventory
  finding: Installed desktop is 2.35.4; four runtime files match repair tree bc267d3/c9ce651. Original Android checkout has unrelated changes.
- timestamp: 2026-10-20T16:20:10+08:00
  source: read-only system and selected application proxy config
  finding: HTTP/HTTPS/SOCKS proxy enabled at local port 7897; persisted application mode is system.
- timestamp: 2026-10-20T16:23:35+08:00
  source: eight-host system resolver sample
  finding: Music API hosts resolve to 198.18/15 Fake-IP range; DNS resolves rather than returning lookup errors.
- timestamp: 2026-10-20
  source: isolated Electron 32.3.2 probe using installed ASAR lyric modules
  finding: System proxy resolves to local 7897. QQ fails ERR_CONNECTION_CLOSED; installed direct lyric transport sees ECONNRESET. LRCLIB succeeds with twenty synced candidates on both paths. Initial AliDNS attempts hit two-second deadlines, Google fallback succeeds.
- timestamp: 2026-10-20
  source: bounded curl DoH/public-IP comparison
  finding: AliDNS can return public A records through local proxy. QQ still fails TLS using public A; LRCLIB succeeds. Transparent interception remains unexcluded.
- timestamp: 2026-10-20
  source: isolated installed lyric transport, three public endpoints
  finding: NetEase returned code200; Kugou song search returned five rows; Kugou lyric search succeeded with zero candidates. System proxy route failed all three connections. Client/UA differences required a controlled follow-up.
- timestamp: 2026-10-20
  source: identical Chromium requests, four GETs
  finding: System proxy route closed NetEase/Kugou connections. Direct mode plus per-process public DNS host map returned HTTP200 and valid metadata. Completion IP matched the supplied public mappings. A final two-request direct/system-DNS control is pending; no additional platform expansion.
- timestamp: 2026-10-20
  source: final two direct-mode Chromium requests without host map
  finding: resolveHost returned one Fake-IP per target. Both NetEase and Kugou connections closed, unlike the successful public-map direct requests. All probes exited and stopped. Formal report is doc/2026-10-20/桌面网络诊断结论.md; original playback issue remains unverified/unfixed.

## Limits

- No original failing track or contemporaneous player error captured.
- CUA can see floating lyric window; main-player diagnostics were not readable. Developer-tools menu was toggled twice to restore its initial state; no playback or network settings changed.
- Fresh isolated profile does not carry user provider verification/account state.
- No business source edits, system DNS/proxy changes, restart, commit, push, or release.
- GSD context initialized with `query state.load`. Specialized GSD roles are fixed to a model outside the user's allowed Luna/Sol route; investigation uses explicit Luna subtasks and primary integration instead of switching to that model.
