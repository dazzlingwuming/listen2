// Instrumentation success confirms execution, not external provider availability.
export function providerOutcomes(log, lane) {
  const sources = lane === 'live-all-providers' ? ['网易云音乐', '酷狗音乐', '酷我音乐', 'QQ音乐', '哔哩哔哩'] : lane === 'live-bilibili' ? ['哔哩哔哩'] : ['网易云音乐', '哔哩哔哩'];
  return sources.map(source => ({ source, status: log.includes(`acceptance-event=live-search-upstream-restriction-${source}`) ? 'DEGRADED' : new RegExp(`acceptance-event=live-search-results-${source}-[1-9][0-9]*`).test(log) ? 'PASS' : 'NOT_VERIFIED' }));
}
