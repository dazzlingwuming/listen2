# Phase 5 Mobile Patterns — Canonical Reference Map

## Scope rule

New Phase-5 product work belongs in `mobile/`. Use its React Native screens/components, Redux/controller state, TypeScript provider client layer, Kotlin native modules, and RNTP integration as the implementation pattern. The legacy `android/` WebView host and `app/listen1_chrome_extension/` AngularJS frontend are read-only references for historic behavior and vocabulary, never current write locations.

The archived WebView plans in `legacy-webview-plans/` document how the old baseline was reasoned about. They are immutable history, not a runnable implementation sequence.

## Reuse before rebuilding

| Need | Canonical mobile pattern | Guardrail |
| --- | --- | --- |
| Provider capability | `mobile/src/api/client.ts` capability projection and typed provider clients | Advertise an operation only when its source-specific route/schema is approved; no broad “provider supported” flag. |
| Search lifecycle | `mobile/src/screens/SearchScreen.tsx` cancellation/epoch/pagination behavior | Scope cache/replies by source + query + cursor/generation; retain prior page on later-page failure. |
| Discover/detail | `mobile/src/screens/DiscoverScreen.tsx` and collection/navigation slices from `jlv` | Do not invent a directory for a source lacking an approved capability. |
| Bilibili authentication/audio | `mobile/src/native/BilibiliSession.kt`, Bilibili client/lyrics paths and `f3q` contracts | Keep QR/account/media resolution in native bounded interfaces; never send session material to JS. |
| Playback | `mobile/src/player/playerController.ts`, `playbackService.ts`, RNTP registration | One native/RNTP authority; commit UI queue/player state only after a successful transaction. |
| Queue identity | player Redux occurrence/queue state | Carry occurrence ID through play-next, reorder, removal, restoration and errors; a track ID alone is not enough. |
| Lyrics | lyric controller/provider/cache paths from `iuc` and `h1s` | Key state by source/track/part occurrence + revision; stale replies cannot overwrite current content. |
| Translation | consented DeepSeek native bridge/cache from `h1s` | Explicit user consent, bounded content, safe error projection, no secrets in JS or logs. |
| Offline | verified cache-first/download boundaries from `g8n` | Keep media in app-private controlled storage; do not promise unsupported-provider offline playback. |
| MV | native semantic/lifecycle flow from `kh4` | MV is capability-gated and must degrade to audio truthfully where audio remains usable. |

## Required design patterns

### Capability matrix

Use operation-granular truth (`search`, `discover`, `detail`, `playback`, `lyrics`, `manualLyrics`, `offset`, `login`, `download`, `mv`) projected from a bounded provider contract. Preserve false/unknown values rather than mapping them to empty success. Error output contains a safe code, presentation label and next action—not raw response text, signed URLs, headers, cookies, tokens or provider payloads.

### Source and occurrence identity

Search/result/detail payloads carry the source and semantic entity identity. Player/queue/lyrics additionally carry a stable occurrence ID and, when needed, selected part and lyric revision. Restore logic matches those identities exactly; it never matches by title, URL, list position or artwork.

### Transactional player state

The controller resolves/loads/commits in a bounded transaction. Only a successful native load changes current occurrence or consumes FIFO play-next. On rejection, keep prior snapshot/queue visible, classify the failure, and offer bounded retry or recovery. Do not optimistically mutate the UI then silently repair it later.

### Lyric revision and projection

Automatic candidates, manual selections, offsets, translations and provenance are revisions of an exact lyric key. A user selection is preferred until cleared/replaced for that key. Projection follows the native playback clock and ignores stale requests, prior tracks, mismatched parts and unmatched fallback content. Screen-reader updates occur on meaningful lyric state/line changes, not polling ticks.

## Anti-patterns

- Copying AngularJS templates, CSS, `loweb` calls or `AndroidHttpBridge` behavior into `mobile/`.
- Letting JavaScript submit an arbitrary URL, headers, cookie, signature or native method name.
- Treating a tab, search result, previous cached item or a desktop adapter as proof of a mobile capability.
- Converting provider failure to `[]`, consuming a queue occurrence on resolver failure, or allowing a stale lyric reply to win.
- Calling unit tests, Metro bundle success or a local fixture “API 35/live-provider/system runtime” acceptance.
