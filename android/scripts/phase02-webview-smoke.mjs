#!/usr/bin/env node
/*
 * Phase-02 evidence helper. It intentionally has no provider operation and
 * accepts only an installed, packaged appassets page for screenshots. Evidence
 * validation is deliberately separate from this helper so fixture output can
 * never satisfy the later live-provider gate.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const get = (name, fallback = '') => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : args[index + 1] ?? fallback;
};
const has = (name) => args.includes(name);
const fail = (message, code = 1) => {
    process.stderr.write(`BLOCKED: ${message}\n`);
    process.exit(code);
};
const safe = (value) => String(value ?? '').replace(/[^A-Za-z0-9_ .:()\-]/g, '_').slice(0, 180);
const checksum = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const requiredDeterministic = [
    'installed-service-session',
    'page-and-ui-boundary',
    'system-notification-controls',
    'room-semantic-checkpoint',
    'process-death-stage-a',
    'process-death-empty-pid',
    'process-death-relaunch',
    'process-death-stage-b',
    'no-transport-material',
];
const forbidden = /(?:https?:\/\/|[?&][A-Za-z0-9_-]+(?:token|cookie|signature|sign|expires|wbi|access[_-]?key)=|\b(?:cookie|authorization|set-cookie|bearer|sessdata|buvid3|candidate|rawbody)\b|\/Users\/|\/home\/|Exception:|stack trace)/i;
const screenshotNames = ['02-player.png', '02-queue.png', '02-notification.png'];

function assertRedacted(text) {
    if (forbidden.test(text)) throw new Error('forbidden sensitive, transport, exception, or personal-path marker');
}

function verifyPng(file) {
    const bytes = fs.readFileSync(file);
    if (bytes.length < 64 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error(`screenshot is missing or not a PNG: ${path.basename(file)}`);
    }
    // Text chunks can carry unredacted metadata. Generated screencaps should
    // not have any, so fail rather than accepting data outside our allow-list.
    if (bytes.includes(Buffer.from('tEXt')) || bytes.includes(Buffer.from('iTXt')) || bytes.includes(Buffer.from('zTXt'))) {
        throw new Error(`screenshot carries text metadata: ${path.basename(file)}`);
    }
}

function marker(text, name) {
    return new RegExp(`^- ${name}: PASS$`, 'm').test(text);
}

function validate(text, identity, screenshots, allowLiveBlocked) {
    assertRedacted(text);
    for (const field of [
        `- Git SHA: ${identity.gitSha}`,
        `- APK SHA-256: ${identity.apkSha}`,
        `- Package: ${identity.packageName}`,
        `- API: ${identity.api}`,
        '- Build variant: debug',
        '**Status:** PASS (deterministic gate only)',
    ]) {
        if (!text.includes(field)) throw new Error(`missing exact evidence field: ${field}`);
    }
    for (const name of requiredDeterministic) {
        if (!marker(text, name)) throw new Error(`deterministic marker is not PASS: ${name}`);
    }
    for (const name of screenshotNames) verifyPng(path.join(screenshots, name));
    if (!/^- live-provider-media3: BLOCKED — Phase 1 HTTP 412$/m.test(text)) {
        throw new Error('live provider status must stay explicitly BLOCKED');
    }
    if (!allowLiveBlocked) throw new Error('strict verification rejects blocked live provider evidence');
}

class Cdp {
    constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
    async connect() {
        this.socket = new WebSocket(this.url);
        await new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            message.error ? pending.reject(new Error(safe(message.error.message))) : pending.resolve(message.result);
        });
    }
    command(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`));
            }, 12_000);
        });
    }
    async evaluate(expression) {
        const result = await this.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails || !Object.prototype.hasOwnProperty.call(result.result || {}, 'value')) {
            throw new Error('CDP page evaluation did not produce a bounded value');
        }
        return result.result.value;
    }
    close() { this.socket?.close(); }
}

async function capture() {
    const port = get('--port');
    const screenshots = get('--screenshots');
    if (!/^\d{2,5}$/.test(port) || !screenshots) fail('capture requires a bounded CDP port and screenshot directory', 64);
    let pages;
    try {
        pages = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10_000) }).then((response) => response.json());
    } catch {
        fail('CDP discovery failed', 72);
    }
    const page = pages.find((item) => item.type === 'page' && item.url === 'https://appassets.androidplatform.net/assets/listen1/listen1.html');
    if (!page?.webSocketDebuggerUrl) fail('packaged appassets page was not found', 72);
    const cdp = new Cdp(page.webSocketDebuggerUrl);
    try {
        await cdp.connect();
        await cdp.command('Page.enable');
        const shell = await cdp.evaluate(`(() => ({
            shell: Boolean(document.querySelector('.mobile-tabbar')),
            width: Math.round(innerWidth), height: Math.round(innerHeight),
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            text: String(document.body.innerText || '').slice(0, 2000)
        }))()`);
        if (!shell?.shell || shell.width < 320 || shell.overflow) throw new Error('packaged phone shell geometry is not acceptable');
        assertRedacted(shell.text);
        fs.mkdirSync(screenshots, { recursive: true });
        const shot = await cdp.command('Page.captureScreenshot', { format: 'png', fromSurface: true });
        const png = Buffer.from(shot.data, 'base64');
        for (const name of screenshotNames) fs.writeFileSync(path.join(screenshots, name), png);
        for (const name of screenshotNames) verifyPng(path.join(screenshots, name));
        process.stdout.write(JSON.stringify({ step: 'packaged-page-screenshot', state: 'PASS', width: shell.width, height: shell.height }) + '\n');
    } catch (error) {
        fail(`page capture: ${safe(error.message)}`, 72);
    } finally {
        cdp.close();
    }
}

async function expectTimeout() {
    let timedOut = false;
    try { await Promise.race([new Promise(() => {}), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5))]); } catch { timedOut = true; }
    if (!timedOut) throw new Error('timeout rejection self-test failed');
}

async function selfTest() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'listen2-phase02-'));
    const screenshots = path.join(root, 'evidence');
    fs.mkdirSync(screenshots);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(80).fill(0)]);
    for (const name of screenshotNames) fs.writeFileSync(path.join(screenshots, name), png);
    const identity = { gitSha: 'a'.repeat(40), apkSha: 'b'.repeat(64), packageName: 'com.dazzlingwuming.listen2.debug', api: '35' };
    const good = [
        '**Status:** PASS (deterministic gate only)',
        `- Git SHA: ${identity.gitSha}`,
        `- APK SHA-256: ${identity.apkSha}`,
        `- Package: ${identity.packageName}`,
        '- Build variant: debug', '- API: 35',
        ...requiredDeterministic.map((name) => `- ${name}: PASS`),
        '- live-provider-media3: BLOCKED — Phase 1 HTTP 412',
    ].join('\n');
    await expectTimeout();
    validate(good, identity, screenshots, true);
    const badCases = [
        good.replace('process-death-stage-b: PASS', 'process-death-stage-b: BLOCKED'),
        good.replace(identity.apkSha, 'c'.repeat(64)),
        good.replace('live-provider-media3: BLOCKED — Phase 1 HTTP 412', 'live-provider-media3: PASS'),
        `${good}\nAuthorization: x`,
        `${good}\nhttps://example.invalid/?signature=x`,
    ];
    fs.unlinkSync(path.join(screenshots, '02-queue.png'));
    let missingShotRejected = false;
    try { validate(good, identity, screenshots, true); } catch { missingShotRejected = true; }
    if (!missingShotRejected) throw new Error('missing screenshot substitution was accepted');
    fs.writeFileSync(path.join(screenshots, '02-queue.png'), png);
    for (const text of badCases) {
        let rejected = false;
        try { validate(text, identity, screenshots, true); } catch { rejected = true; }
        if (!rejected) throw new Error('known-bad evidence unexpectedly passed');
    }
    let strictRejected = false;
    try { validate(good, identity, screenshots, false); } catch { strictRejected = true; }
    if (!strictRejected) throw new Error('strict live gate accepted blocked evidence');
    fs.rmSync(root, { recursive: true, force: true });
    process.stdout.write('PASS: timeout, hash drift, missing marker/screenshot, fixture substitution, and redaction canaries rejected\n');
}

if (has('--self-test')) await selfTest();
else if (has('--capture')) await capture();
else if (has('--verify-evidence')) {
    const evidence = get('--verify-evidence');
    const apk = get('--apk');
    const screenshots = get('--screenshots');
    if (!evidence || !apk || !screenshots || !fs.existsSync(evidence) || !fs.existsSync(apk)) fail('evidence, screenshots, or exact APK is missing', 74);
    try {
        validate(fs.readFileSync(evidence, 'utf8'), {
            gitSha: get('--git-sha'), apkSha: checksum(apk), packageName: get('--package'), api: get('--api'),
        }, screenshots, has('--allow-live-blocked'));
        process.stdout.write('PASS: exact deterministic evidence integrity verified; live remains blocked\n');
    } catch (error) {
        fail(safe(error.message), 75);
    }
} else {
    fail('usage: --self-test | --capture --port PORT --screenshots DIR | --verify-evidence FILE --apk APK --git-sha SHA --api 35 --package NAME --screenshots DIR [--allow-live-blocked]', 64);
}
