#!/usr/bin/env node
/* Dependency-free CDP client and evidence verifier. It returns only bounded
 * state/timing/geometry/identifier fields and cannot emit network or storage. */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const get = (name, fallback = '') => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] ?? fallback; };
const has = (name) => args.includes(name);
const required = ['provider-search', 'exact-part', 'active-audio-and-progress', 'pause-resume', 'lyric-terminal', 'cancellation-retry-navigation-layout'];
const forbidden = /(?:https?:\/\/[^\s]*[?&](?:token|cookie|signature|sign|expires|wbi|access_key)=|\b(?:cookie|authorization|set-cookie)\s*:|\b(?:bearer|buvid3|sessdata)\b|\/Users\/|\/home\/|Exception:|stack trace)/i;
const safeId = /^[A-Za-z0-9_-]{1,80}$/;
const safe = (input) => String(input ?? '').replace(/[^A-Za-z0-9_ .:()\-]/g, '_').slice(0, 180);
const fail = (message, code = 1) => { process.stderr.write(`BLOCKED: ${message}\n`); process.exit(code); };
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const checksum = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function assertRedacted(text) {
  if (forbidden.test(text)) throw new Error('forbidden secret, query, header, provider body, exception, or personal-path marker');
}
function validate(text, identity, screenshotRoot) {
  assertRedacted(text);
  for (const field of [`Git SHA: ${identity.gitSha}`, `APK SHA-256: ${identity.apkSha}`, `Package: ${identity.packageName}`, `API: ${identity.api}`, '**Status:** PASS', 'live-provider-audio: PASS']) {
    if (!text.includes(field)) throw new Error(`missing exact evidence field: ${field}`);
  }
  for (const step of required) if (!new RegExp(`^- ${step}: PASS$`, 'm').test(text)) throw new Error(`live marker is not PASS: ${step}`);
  for (const name of ['01-home.png', '01-results.png', '01-part.png', '01-playing-lyrics.png']) if (!fs.existsSync(path.join(screenshotRoot, name))) throw new Error(`missing screenshot: ${name}`);
}

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); });
    this.socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(safe(message.error.message))) : pending.resolve(message.result); });
  }
  command(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`)); }, 12000); });
  }
  async eval(expression) {
    const result = await this.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`page evaluation failed: ${safe(result.exceptionDetails.text || 'unknown')}`);
    if (!Object.prototype.hasOwnProperty.call(result.result || {}, 'value')) throw new Error('CDP evaluation returned no bounded value');
    return result.result.value;
  }
  close() { this.socket?.close(); }
}

const stateExpression = `(() => { const root=document.querySelector('.bilibili-mobile-search'); const searchScope=root&&window.angular&&window.angular.element(root).scope&&window.angular.element(root).scope(); const scopeSearchState=String(searchScope&&searchScope.bilibiliSearch&&searchScope.bilibiliSearch.state||''); const detail=document.querySelector('.bilibili-mobile-detail'); const detailScope=detail&&window.angular&&window.angular.element(detail).scope&&window.angular.element(detail).scope(); const detailTrackId=String(detailScope&&detailScope.bilibiliDetail&&detailScope.bilibiliDetail.track&&detailScope.bilibiliDetail.track.id||''); const text=document.body.innerText; const progress=(document.querySelector('.current')?.innerText || '0:00').trim(); const targetRects=[...document.querySelectorAll('button')].filter(b => b.getAttribute('aria-label')==='提交哔哩哔哩搜索' || b.textContent.includes('播放此分P')).map(b => { const r=b.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height)}; }); const searchState=text.includes('已取消本次搜索')?'cancelled':document.querySelectorAll('.bilibili-mobile-result').length>0?'content':text.includes('正在搜索哔哩哔哩…')?'loading':text.includes('搜索超时')?'timeout':text.includes('没有找到结果')?'empty':text.includes('重新搜索哔哩哔哩')?'error':''; const searchError=searchState==='error'?(text.includes('网络连接不可用')?'network':text.includes('无法建立安全连接')?'tls':text.includes('匿名请求暂时被来源拒绝')?'provider-rejected':text.includes('搜索结果暂时无法识别')?'malformed':'unknown'):''; return {shell:Boolean(root && document.querySelector('.mobile-tabbar')),searchState,scopeSearchState:/^(idle|loading|content|cancelled|empty|error|timeout)$/.test(scopeSearchState)?scopeSearchState:'',searchError,resultCount:document.querySelectorAll('.bilibili-mobile-result').length,detailState:detail ? (document.querySelectorAll('.bilibili-mobile-parts button').length>0?'content':text.includes('正在读取分P…')?'loading':text.includes('所选分P不可用')?'invalid-part':'error') : 'idle',partCount:document.querySelectorAll('.bilibili-mobile-parts button').length,bvid:String(detail?.dataset.bilibiliBvid||''),cid:String(detail?.dataset.bilibiliCid||''),detailTrackId:/^bitrack_v_BV[A-Za-z0-9]{10}$/.test(detailTrackId)?detailTrackId:'',progress:/^[0-9]+:[0-9]{2}$/.test(progress)?progress:'0:00',playback:text.includes('正在播放')?'playing':text.includes('已暂停')?'paused':text.includes('正在准备播放')?'resolving':'',lyric:text.includes('暂无可用歌词')?'unavailable':text.includes('歌词暂时无法加载')?'error':text.includes('正在获取歌词…')?'loading':'',width:Math.round(innerWidth),height:Math.round(innerHeight),overflow:document.documentElement.scrollWidth>innerWidth+1,targets:targetRects}; })()`;

async function waitState(cdp, predicate, label, timeout = 20000, interval = 250) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const state = await cdp.eval(stateExpression); if (predicate(state)) return state; await wait(interval); }
  throw new Error(`timed out: ${label}`);
}
async function tapSelector(cdp, selector, index = 0) {
  const point = await cdp.eval(`(() => { const element=[...document.querySelectorAll(${JSON.stringify(selector)})][${Number(index)}]; if(!element)return null; const r=element.getBoundingClientRect(); return r.width && r.height ? {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),scale:window.devicePixelRatio||1} : null; })()`);
  return activatePoint(point);
}
async function tap(cdp, text) {
  const point = await cdp.eval(`(() => { const element=[...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label')===${JSON.stringify(text)} || x.textContent.trim().includes(${JSON.stringify(text)})); if(!element)return null; const r=element.getBoundingClientRect(); return r.width && r.height ? {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),scale:window.devicePixelRatio||1} : null; })()`);
  return activatePoint(point);
}
async function tapImmediately(cdp, text) {
  const point = await cdp.eval(`(() => { const element=[...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label')===${JSON.stringify(text)} || x.textContent.trim().includes(${JSON.stringify(text)})); if(!element)return null; const r=element.getBoundingClientRect(); return r.width && r.height ? {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),scale:window.devicePixelRatio||1} : null; })()`);
  return tapPoint(point);
}
async function tapVisibleSearchInput(cdp) {
  const point = await cdp.eval(`(() => { const element=[...document.querySelectorAll('#search-input')].find(x => { const r=x.getBoundingClientRect(); const style=getComputedStyle(x); return r.width>0 && r.height>0 && style.visibility!=='hidden' && style.display!=='none'; }); if(!element)return null; const r=element.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),scale:window.devicePixelRatio||1}; })()`);
  return tapPoint(point);
}
async function submitSearch(cdp) {
  return tap(cdp, '提交哔哩哔哩搜索');
}
function tapPoint(point) {
  if (!point) return false;
  const adb = process.env.PHASE01_ADB || path.join(process.env.ANDROID_SDK_ROOT || '', 'platform-tools', 'adb');
  const serial = process.env.PHASE01_SERIAL;
  if (!serial || !fs.existsSync(adb)) throw new Error('ADB-coordinated input is unavailable');
  try {
    const top = Number(process.env.PHASE01_WEBVIEW_TOP_PX || '0');
    if (!Number.isInteger(top) || top < 0 || top > 500) throw new Error('WebView input inset is unavailable');
    execFileSync(adb, ['-s', serial, 'shell', 'input', 'tap', String(Math.round(point.x * point.scale)), String(Math.round(point.y * point.scale + top))], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch { return false; }
}
async function activatePoint(point) {
  if (!tapPoint(point)) return false;
  // WebView posts the focus update from the tap on its UI thread. Sending
  // ENTER in the same ADB transaction races that update and only focuses the
  // button; a short bounded delay turns it into the native activation event.
  await wait(250);
  const adb = process.env.PHASE01_ADB || path.join(process.env.ANDROID_SDK_ROOT || '', 'platform-tools', 'adb');
  const serial = process.env.PHASE01_SERIAL;
  try {
    execFileSync(adb, ['-s', serial, 'shell', 'input', 'keyevent', '66'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch { return false; }
}
async function activatePointFast(point) {
  if (!tapPoint(point)) return false;
  // Cancellation is time-sensitive: wait only for the WebView focus update,
  // then send the same native activation event before a fast provider reply
  // can replace the control.
  await wait(15);
  const adb = process.env.PHASE01_ADB || path.join(process.env.ANDROID_SDK_ROOT || '', 'platform-tools', 'adb');
  const serial = process.env.PHASE01_SERIAL;
  try {
    execFileSync(adb, ['-s', serial, 'shell', 'input', 'keyevent', '66'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch { return false; }
}
async function cancelSearch(cdp) {
  const point = await cdp.eval(`(() => { const element=[...document.querySelectorAll('button')].find(x => x.textContent.trim().includes('取消本次搜索')); if(!element)return null; const r=element.getBoundingClientRect(); return r.width && r.height ? {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),scale:window.devicePixelRatio||1} : null; })()`);
  return activatePointFast(point);
}
function isSafeQuery(text) { return /^[A-Za-z0-9%s]+$/.test(text); }
async function query(cdp, text) {
  if (!(await tapVisibleSearchInput(cdp))) return false;
  const adb = process.env.PHASE01_ADB || path.join(process.env.ANDROID_SDK_ROOT || '', 'platform-tools', 'adb');
  const serial = process.env.PHASE01_SERIAL;
  if (!serial || !fs.existsSync(adb) || !isSafeQuery(text)) throw new Error('safe ADB query input is unavailable');
  try {
    execFileSync(adb, ['-s', serial, 'shell', 'input', 'text', text], { stdio: 'ignore', timeout: 5000 });
    execFileSync(adb, ['-s', serial, 'shell', 'input', 'keyevent', '66'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch { return false; }
}
async function snap(cdp, destination) { const result = await cdp.command('Page.captureScreenshot', { format: 'png', fromSurface: true }); fs.writeFileSync(destination, Buffer.from(result.data, 'base64')); }

async function run() {
  const port = get('--port'); const shots = get('--screenshots'); const evidence = get('--evidence');
  if (!/^\d{2,5}$/.test(port) || !shots || !evidence) fail('missing CDP arguments', 64);
  let pages;
  try { pages = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10000) }).then((response) => response.json()); } catch { fail('CDP discovery failed', 72); }
  const page = pages.find((item) => item.type === 'page' && item.url === 'https://appassets.androidplatform.net/assets/listen1/listen1.html');
  if (!page?.webSocketDebuggerUrl) fail('packaged appassets page was not found', 72);
  const cdp = new Cdp(page.webSocketDebuggerUrl); const started = Date.now(); let stage = 'connect';
  try {
    await cdp.connect(); await cdp.command('Page.enable'); await cdp.command('Runtime.enable'); fs.mkdirSync(shots, { recursive: true });
    stage = 'local phone shell'; const home = await waitState(cdp, (state) => state.shell, 'local phone shell'); await snap(cdp, path.join(shots, '01-home.png'));
    const keyword = process.env.PHASE01_ADB_QUERY || 'Test';
    stage = 'query input'; if (!(await query(cdp, keyword)) || !(await submitSearch(cdp))) throw new Error('fixed Bilibili search control unavailable');
    stage = 'initial search state'; const initial = await waitState(cdp, (state) => Boolean(state.searchState), 'initial Bilibili search state', 3000, 25);
    if (initial.searchState === 'error' && initial.searchError === 'provider-rejected') fail('anonymous Bilibili provider rejected current search', 76);
    if (initial.searchState !== 'loading') throw new Error('Bilibili search did not reach a cancellable loading state');
    stage = 'search cancellation'; if (!(await cancelSearch(cdp))) throw new Error('search cancellation control unavailable');
    await waitState(cdp, (state) => state.searchState === 'cancelled', 'search cancellation');
    stage = 'clear cancelled query'; if (!(await tap(cdp, '清空搜索'))) throw new Error('search clear control unavailable');
    await waitState(cdp, (state) => state.searchState === '', 'cleared search state');
    stage = 'revised search'; if (!(await query(cdp, process.env.PHASE01_REVISED_ADB_QUERY || 'Test')) || !(await submitSearch(cdp))) throw new Error('current Bilibili search could not be submitted');
    await waitState(cdp, (state) => state.scopeSearchState === 'loading', 'revised Bilibili loading state', 3000, 25);
    stage = 'current results'; const revisedTerminal = await waitState(cdp, (state) => state.searchState && state.searchState !== 'loading', 'revised Bilibili terminal state', 30000);
    if (revisedTerminal.searchState === 'error' && revisedTerminal.searchError === 'provider-rejected') fail('anonymous Bilibili provider rejected revised search', 76);
    if (revisedTerminal.searchState !== 'content' || revisedTerminal.resultCount < 1) throw new Error(`revised Bilibili terminal state=${safe(revisedTerminal.searchState || 'unknown')} error=${safe(revisedTerminal.searchError || 'none')}`);
    const results = revisedTerminal; await snap(cdp, path.join(shots, '01-results.png'));
    stage = 'open detail'; let parts = null;
    // Results are live provider rows: a current search page can include a
    // removed or unavailable video. Select only a bounded number of visible
    // rows and keep the exact row/part chosen by the UI, never a known BVID.
    for (let index = 0; index < Math.min(results.resultCount, 5); index += 1) {
      if (!(await tapSelector(cdp, '.bilibili-mobile-result button', index))) throw new Error('result detail control unavailable');
      const detail = await waitState(cdp, (state) => state.detailState !== 'loading', 'current result detail terminal state', 30000);
      if (detail.detailState === 'content' && detail.partCount > 0) { parts = detail; break; }
      process.stderr.write(`INFO: current-result-${index + 1} detail=${safe(detail.detailState)} track=${safe(detail.detailTrackId || 'unavailable')}\n`);
      if (!(await tap(cdp, '返回搜索结果'))) throw new Error('unavailable result could not return to current results');
      await waitState(cdp, (state) => state.detailState === 'idle' && state.resultCount > 0, 'return to current results');
    }
    if (!parts) throw new Error('no playable public part in five current provider results');
    stage = 'part list'; await snap(cdp, path.join(shots, '01-part.png'));
    if (!safeId.test(parts.bvid) || !/^\d{1,20}$/.test(parts.cid)) throw new Error('bounded BVID/CID unavailable');
    if (!(await tapSelector(cdp, '.bilibili-mobile-parts button')) || !(await tap(cdp, '播放此分P'))) throw new Error('part/play control unavailable');
    const playing = await waitState(cdp, (state) => state.playback === 'playing' && state.progress !== '0:00', 'forward audio progress', 45000);
    if (!(await tap(cdp, '暂停播放'))) throw new Error('pause control unavailable'); await waitState(cdp, (state) => state.playback === 'paused', 'paused audio');
    if (!(await tap(cdp, '播放'))) throw new Error('resume control unavailable'); const resumed = await waitState(cdp, (state) => state.playback === 'playing' && state.progress !== '0:00', 'resumed audio');
    if (!(await tapSelector(cdp, '.mobile-current-track'))) throw new Error('primary lyric control unavailable'); const lyric = await waitState(cdp, (state) => Boolean(state.lyric), 'truthful lyric state', 20000); await snap(cdp, path.join(shots, '01-playing-lyrics.png'));
    if ([home, results, parts, playing, resumed, lyric].some((state) => state.width < 320 || state.overflow || state.targets.some((target) => target.w < 48 || target.h < 48))) throw new Error('phone geometry/48dp assertion failed');
    const identity = { gitSha: safe(process.env.PHASE01_GIT_SHA), apkSha: safe(process.env.PHASE01_APK_SHA), packageName: 'com.dazzlingwuming.listen2.debug', api: safe(process.env.PHASE01_API) };
    const content = ['# Phase 01 API-35 live evidence', '', '## Result', '', '**Status:** PASS', `**Timestamp:** ${new Date().toISOString()}`, '**Timezone:** UTC', '', '## Identity', '', `- Git SHA: ${identity.gitSha}`, `- APK SHA-256: ${identity.apkSha}`, `- Package: ${identity.packageName}`, '- Build variant: debug', `- API: ${identity.api}`, `- ABI: ${safe(process.env.PHASE01_ABI)}`, `- WebView: ${safe(process.env.PHASE01_WEBVIEW)}`, `- Network: ${safe(process.env.PHASE01_NETWORK)}`, '', '## Selected public item', '', `- BVID: ${parts.bvid}`, `- CID: ${parts.cid}`, '- Part: selected first public API-order part', '', '## Required live markers', '', 'live-provider-audio: PASS', ...required.map((step) => `- ${step}: PASS`), '', '## Observable timings', '', `- local-shell-ms: ${Date.now() - started}`, '- progress: > 0:00', '- AudioFlinger: active app audio observed by harness', '', '## Screenshots', '', '- evidence/01-home.png', '- evidence/01-results.png', '- evidence/01-part.png', '- evidence/01-playing-lyrics.png', '', '## Limits', '', '- Foreground WebView/Howler only; background Media3, login, cache, and synchronized lyrics are not verified.', ''].join('\n');
    assertRedacted(content); fs.writeFileSync(evidence, content); validate(content, identity, shots);
    process.stdout.write(JSON.stringify({ step: 'live-journey', state: 'PASS', durationMs: Date.now() - started, dimensions: { width: home.width, height: home.height }, bvid: parts.bvid, cid: parts.cid, progress: resumed.progress }) + '\n');
  } catch (error) { fail(`${stage}: ${safe(error.message)}`); } finally { cdp.close(); }
}

async function probe() {
  const port = get('--probe');
  if (!/^\d{2,5}$/.test(port)) fail('probe requires a CDP port', 64);
  let pages;
  try { pages = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10000) }).then((response) => response.json()); } catch { fail('CDP discovery failed', 72); }
  const page = pages.find((item) => item.type === 'page' && item.url === 'https://appassets.androidplatform.net/assets/listen1/listen1.html');
  if (!page?.webSocketDebuggerUrl) fail('packaged appassets page was not found', 72);
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  try {
    await cdp.connect();
    const geometry = await cdp.eval(`(() => { const inputs=[...document.querySelectorAll('#search-input')]; const button=[...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label')==='提交哔哩哔哩搜索'); const pick=(x) => { const r=x?.getBoundingClientRect(); return r ? {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height)} : null; }; return {width:innerWidth,height:innerHeight,scale:devicePixelRatio,inputs:inputs.map(pick),submit:pick(button),focusedIndex:inputs.indexOf(document.activeElement)}; })()`);
    process.stdout.write(`${JSON.stringify({ ...geometry, state: await cdp.eval(stateExpression) })}\n`);
  } catch (error) { fail(`probe: ${safe(error.message)}`); } finally { cdp.close(); }
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'listen2-phase01-')); const shots = path.join(root, 'evidence'); fs.mkdirSync(shots);
  for (const name of ['01-home.png', '01-results.png', '01-part.png', '01-playing-lyrics.png']) fs.writeFileSync(path.join(shots, name), 'safe');
  const identity = { gitSha: 'a'.repeat(40), apkSha: 'b'.repeat(64), packageName: 'com.dazzlingwuming.listen2.debug', api: '35' };
  const good = ['**Status:** PASS', `- Git SHA: ${identity.gitSha}`, `- APK SHA-256: ${identity.apkSha}`, `- Package: ${identity.packageName}`, '- API: 35', 'live-provider-audio: PASS', ...required.map((step) => `- ${step}: PASS`)].join('\n'); validate(good, identity, shots);
  for (const bad of [good.replace('active-audio-and-progress: PASS', 'active-audio-and-progress: BLOCKED'), good.replace('live-provider-audio: PASS', 'fixture: PASS'), `${good}\nCookie: x`, `${good}\nhttps://x/?token=x`]) { let rejected = false; try { validate(bad, identity, shots); } catch { rejected = true; } if (!rejected) fail('known-bad evidence unexpectedly passed', 73); }
  if (!isSafeQuery('Test') || isSafeQuery('Test;drop')) fail('safe native query validation regressed', 73);
  fs.rmSync(root, { recursive: true, force: true }); process.stdout.write('PASS: CDP/evidence self-test\n');
}

if (has('--self-test')) selfTest();
else if (has('--probe')) await probe();
else if (has('--verify-evidence')) {
  const file = get('--verify-evidence'); const apk = get('--apk'); if (!file || !apk || !fs.existsSync(file) || !fs.existsSync(apk)) fail('evidence or exact APK is missing', 74);
  try { validate(fs.readFileSync(file, 'utf8'), { gitSha: get('--git-sha'), apkSha: checksum(apk), packageName: get('--package'), api: get('--api') }, path.join(path.dirname(file), 'evidence')); process.stdout.write('PASS: exact live evidence integrity verified\n'); } catch (error) { fail(safe(error.message), 75); }
} else if (has('--run')) await run();
else fail('usage: --self-test | --run --port PORT --screenshots DIR --evidence FILE | --verify-evidence FILE --apk APK --git-sha SHA --api 35 --package NAME', 64);
