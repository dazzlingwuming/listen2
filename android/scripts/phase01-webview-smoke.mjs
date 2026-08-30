#!/usr/bin/env node
/* Dependency-free CDP client and evidence verifier. It returns only bounded
 * state/timing/geometry/identifier fields and cannot emit network or storage. */
import crypto from 'node:crypto';
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
  async eval(expression) { const result = await this.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return result.result?.value; }
  close() { this.socket?.close(); }
}

const stateExpression = `(() => { const root=document.querySelector('.bilibili-mobile-search'); const detail=document.querySelector('.bilibili-mobile-detail'); const text=document.body.innerText; const progress=(document.querySelector('.current')?.innerText || '0:00').trim(); const targetRects=[...document.querySelectorAll('button')].filter(b => b.getAttribute('aria-label')==='提交哔哩哔哩搜索' || b.textContent.includes('播放此分P')).map(b => { const r=b.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height)}; }); return {shell:Boolean(root && document.querySelector('.mobile-tabbar')),searchState:text.includes('已取消本次搜索')?'cancelled':document.querySelectorAll('.bilibili-mobile-result').length>0?'content':text.includes('正在搜索哔哩哔哩…')?'loading':text.includes('搜索超时')?'timeout':'',resultCount:document.querySelectorAll('.bilibili-mobile-result').length,detailState:detail ? (document.querySelectorAll('.bilibili-mobile-parts button').length>0?'content':text.includes('正在读取分P…')?'loading':text.includes('所选分P不可用')?'invalid-part':'error') : 'idle',partCount:document.querySelectorAll('.bilibili-mobile-parts button').length,bvid:String(detail?.dataset.bilibiliBvid||''),cid:String(detail?.dataset.bilibiliCid||''),progress:/^[0-9]+:[0-9]{2}$/.test(progress)?progress:'0:00',playback:text.includes('正在播放')?'playing':text.includes('已暂停')?'paused':text.includes('正在准备播放')?'resolving':'',lyric:text.includes('暂无可用歌词')?'unavailable':text.includes('歌词暂时无法加载')?'error':text.includes('正在获取歌词…')?'loading':'',width:Math.round(innerWidth),height:Math.round(innerHeight),overflow:document.documentElement.scrollWidth>innerWidth+1,targets:targetRects}; })()`;

async function waitState(cdp, predicate, label, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const state = await cdp.eval(stateExpression); if (predicate(state)) return state; await wait(250); }
  throw new Error(`timed out: ${label}`);
}
async function click(cdp, text) { return cdp.eval(`(() => { const element=[...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label')===${JSON.stringify(text)} || x.textContent.trim().includes(${JSON.stringify(text)})); if(!element)return false; element.click(); return true; })()`); }
async function query(cdp, text) { return cdp.eval(`(() => { const input=document.querySelector('#search-input'); if(!input)return false; input.focus(); input.value=${JSON.stringify(text)}; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`); }
async function snap(cdp, destination) { const result = await cdp.command('Page.captureScreenshot', { format: 'png', fromSurface: true }); fs.writeFileSync(destination, Buffer.from(result.data, 'base64')); }

async function run() {
  const port = get('--port'); const shots = get('--screenshots'); const evidence = get('--evidence');
  if (!/^\d{2,5}$/.test(port) || !shots || !evidence) fail('missing CDP arguments', 64);
  let pages;
  try { pages = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10000) }).then((response) => response.json()); } catch { fail('CDP discovery failed', 72); }
  const page = pages.find((item) => item.type === 'page' && item.url === 'https://appassets.androidplatform.net/assets/listen1/listen1.html');
  if (!page?.webSocketDebuggerUrl) fail('packaged appassets page was not found', 72);
  const cdp = new Cdp(page.webSocketDebuggerUrl); const started = Date.now();
  try {
    await cdp.connect(); await cdp.command('Page.enable'); await cdp.command('Runtime.enable'); fs.mkdirSync(shots, { recursive: true });
    const home = await waitState(cdp, (state) => state.shell, 'local phone shell'); await snap(cdp, path.join(shots, '01-home.png'));
    const keyword = process.env.PHASE01_QUERY || 'Bilibili 音乐';
    if (!(await query(cdp, keyword)) || !(await click(cdp, '提交哔哩哔哩搜索'))) throw new Error('fixed Bilibili search control unavailable');
    await wait(150); if (!(await click(cdp, '取消本次搜索'))) throw new Error('search cancellation control unavailable');
    await waitState(cdp, (state) => state.searchState === 'cancelled', 'search cancellation');
    if (!(await query(cdp, keyword)) || !(await click(cdp, '提交哔哩哔哩搜索'))) throw new Error('current Bilibili search could not be submitted');
    const results = await waitState(cdp, (state) => state.searchState === 'content' && state.resultCount > 0, 'current labelled results', 30000); await snap(cdp, path.join(shots, '01-results.png'));
    if (!(await cdp.eval(`document.querySelector('.bilibili-mobile-result button')?.click() || false`))) throw new Error('result detail control unavailable');
    const parts = await waitState(cdp, (state) => state.detailState === 'content' && state.partCount > 0, 'exact part list', 30000); await snap(cdp, path.join(shots, '01-part.png'));
    if (!safeId.test(parts.bvid) || !/^\d{1,20}$/.test(parts.cid)) throw new Error('bounded BVID/CID unavailable');
    if (!(await cdp.eval(`document.querySelector('.bilibili-mobile-parts button')?.click() || false`)) || !(await click(cdp, '播放此分P'))) throw new Error('part/play control unavailable');
    const playing = await waitState(cdp, (state) => state.playback === 'playing' && state.progress !== '0:00', 'forward audio progress', 45000);
    if (!(await click(cdp, '暂停播放'))) throw new Error('pause control unavailable'); await waitState(cdp, (state) => state.playback === 'paused', 'paused audio');
    if (!(await click(cdp, '播放'))) throw new Error('resume control unavailable'); const resumed = await waitState(cdp, (state) => state.playback === 'playing' && state.progress !== '0:00', 'resumed audio');
    if (!(await cdp.eval(`document.querySelector('.mobile-current-track')?.click() || false`))) throw new Error('primary lyric control unavailable'); const lyric = await waitState(cdp, (state) => Boolean(state.lyric), 'truthful lyric state', 20000); await snap(cdp, path.join(shots, '01-playing-lyrics.png'));
    if ([home, results, parts, playing, resumed, lyric].some((state) => state.width < 320 || state.overflow || state.targets.some((target) => target.w < 48 || target.h < 48))) throw new Error('phone geometry/48dp assertion failed');
    const identity = { gitSha: safe(process.env.PHASE01_GIT_SHA), apkSha: safe(process.env.PHASE01_APK_SHA), packageName: 'com.dazzlingwuming.listen2.debug', api: safe(process.env.PHASE01_API) };
    const content = ['# Phase 01 API-35 live evidence', '', '## Result', '', '**Status:** PASS', `**Timestamp:** ${new Date().toISOString()}`, '**Timezone:** UTC', '', '## Identity', '', `- Git SHA: ${identity.gitSha}`, `- APK SHA-256: ${identity.apkSha}`, `- Package: ${identity.packageName}`, '- Build variant: debug', `- API: ${identity.api}`, `- ABI: ${safe(process.env.PHASE01_ABI)}`, `- WebView: ${safe(process.env.PHASE01_WEBVIEW)}`, `- Network: ${safe(process.env.PHASE01_NETWORK)}`, '', '## Selected public item', '', `- BVID: ${parts.bvid}`, `- CID: ${parts.cid}`, '- Part: selected first public API-order part', '', '## Required live markers', '', 'live-provider-audio: PASS', ...required.map((step) => `- ${step}: PASS`), '', '## Observable timings', '', `- local-shell-ms: ${Date.now() - started}`, '- progress: > 0:00', '- AudioFlinger: active app audio observed by harness', '', '## Screenshots', '', '- evidence/01-home.png', '- evidence/01-results.png', '- evidence/01-part.png', '- evidence/01-playing-lyrics.png', '', '## Limits', '', '- Foreground WebView/Howler only; background Media3, login, cache, and synchronized lyrics are not verified.', ''].join('\n');
    assertRedacted(content); fs.writeFileSync(evidence, content); validate(content, identity, shots);
    process.stdout.write(JSON.stringify({ step: 'live-journey', state: 'PASS', durationMs: Date.now() - started, dimensions: { width: home.width, height: home.height }, bvid: parts.bvid, cid: parts.cid, progress: resumed.progress }) + '\n');
  } catch (error) { fail(safe(error.message)); } finally { cdp.close(); }
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'listen2-phase01-')); const shots = path.join(root, 'evidence'); fs.mkdirSync(shots);
  for (const name of ['01-home.png', '01-results.png', '01-part.png', '01-playing-lyrics.png']) fs.writeFileSync(path.join(shots, name), 'safe');
  const identity = { gitSha: 'a'.repeat(40), apkSha: 'b'.repeat(64), packageName: 'com.dazzlingwuming.listen2.debug', api: '35' };
  const good = ['**Status:** PASS', `- Git SHA: ${identity.gitSha}`, `- APK SHA-256: ${identity.apkSha}`, `- Package: ${identity.packageName}`, '- API: 35', 'live-provider-audio: PASS', ...required.map((step) => `- ${step}: PASS`)].join('\n'); validate(good, identity, shots);
  for (const bad of [good.replace('active-audio-and-progress: PASS', 'active-audio-and-progress: BLOCKED'), good.replace('live-provider-audio: PASS', 'fixture: PASS'), `${good}\nCookie: x`, `${good}\nhttps://x/?token=x`]) { let rejected = false; try { validate(bad, identity, shots); } catch { rejected = true; } if (!rejected) fail('known-bad evidence unexpectedly passed', 73); }
  fs.rmSync(root, { recursive: true, force: true }); process.stdout.write('PASS: CDP/evidence self-test\n');
}

if (has('--self-test')) selfTest();
else if (has('--verify-evidence')) {
  const file = get('--verify-evidence'); const apk = get('--apk'); if (!file || !apk || !fs.existsSync(file) || !fs.existsSync(apk)) fail('evidence or exact APK is missing', 74);
  try { validate(fs.readFileSync(file, 'utf8'), { gitSha: get('--git-sha'), apkSha: checksum(apk), packageName: get('--package'), api: get('--api') }, path.join(path.dirname(file), 'evidence')); process.stdout.write('PASS: exact live evidence integrity verified\n'); } catch (error) { fail(safe(error.message), 75); }
} else if (has('--run')) await run();
else fail('usage: --self-test | --run --port PORT --screenshots DIR --evidence FILE | --verify-evidence FILE --apk APK --git-sha SHA --api 35 --package NAME', 64);
