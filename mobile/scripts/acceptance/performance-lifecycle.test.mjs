import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performanceInstrumentationOk, sanitizePerformanceInstrumentation } from './performance-evidence.mjs';

const runner = readFileSync(new URL('./run-performance-recovery.sh', import.meta.url), 'utf8');
const helpers = runner.slice(runner.indexOf('instrument() {'), runner.indexOf('# The startup probe is deliberately separate'));
const temporary = mkdtempSync(resolve(tmpdir(), 'listen2-performance-lifecycle-'));
try {
  const mock = resolve(temporary, 'adb');
  writeFileSync(mock, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2).slice(3);
fs.appendFileSync(process.env.COMMANDS, JSON.stringify(args) + '\\n');
if (args[0] === 'pidof') { process.stdout.write(fs.readFileSync(process.env.PID_FILE)); }
else if (args[0] === 'am' && args[1] === 'start') { if (process.env.CASE === 'launch-failure') process.exit(1); }
else if (args[0] === 'am' && args[1] === 'instrument') {
  if (process.env.CASE === 'changed-pid') fs.writeFileSync(process.env.PID_FILE, '202');
  console.log(process.env.CASE === 'instrument-failure' ? 'INSTRUMENTATION_STATUS: failureType=AssertionError' : 'INSTRUMENTATION_STATUS: stream=Phase08Instrumentation completed');
  console.log('INSTRUMENTATION_CODE: -1');
} else process.exit(2);
`, { mode: 0o700 });
  for (const scenario of ['pass', 'changed-pid', 'launch-failure', 'missing-pid', 'instrument-failure', 'cold-unmodified', 'probe-existing', 'anchor-valid', 'anchor-invalid']) {
    const commands = resolve(temporary, `${scenario}.commands`), pidFile = resolve(temporary, `${scenario}.pid`), out = resolve(temporary, `${scenario}.txt`);
    writeFileSync(commands, ''); writeFileSync(pidFile, scenario === 'missing-pid' ? '' : '101');
    const call = scenario === 'cold-unmodified' ? 'instrument fixed.Class "$OUT"' : `instrument_local_retained fixed.Class "$OUT" ${scenario === 'probe-existing' ? 'existing' : scenario === 'anchor-valid' ? "'' 100000" : scenario === 'anchor-invalid' ? "'' private-sentinel" : ''}`;
    const result = execFileSync('bash', ['-c', `set -u\n${helpers}\nif ${call}; then echo PASS; else echo FAIL; fi`], {
      cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8',
      env: { ...process.env, ADB: mock, SERIAL: 'fixture', PACKAGE: 'com.dazzlingwuming.listen2', TEST_PACKAGE: 'fixture.test', DEVICE_API: '35', COMMANDS: commands, PID_FILE: pidFile, OUT: out, CASE: scenario },
    }).trim();
    assert.equal(result, ['pass', 'cold-unmodified', 'probe-existing', 'anchor-valid', 'anchor-invalid'].includes(scenario) ? 'PASS' : 'FAIL');
    const calls = readFileSync(commands, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const instrumentation = calls.find(args => args[1] === 'instrument');
    if (['launch-failure', 'missing-pid'].includes(scenario)) assert.equal(instrumentation, undefined);
    else assert.equal(instrumentation.includes('--no-restart'), scenario !== 'cold-unmodified');
    if (['cold-unmodified', 'probe-existing'].includes(scenario)) assert.equal(calls.some(args => args[1] === 'start'), false);
    if (scenario === 'anchor-valid') assert.equal(instrumentation[instrumentation.indexOf('phase08ResumeAnchorMs') + 1], '100000');
    if (scenario === 'anchor-invalid') assert.equal(instrumentation.includes('private-sentinel'), false);
    const evidence = readFileSync(out, 'utf8');
    assert.equal(performanceInstrumentationOk(evidence), ['pass', 'cold-unmodified', 'probe-existing', 'anchor-valid', 'anchor-invalid'].includes(scenario));
    assert.equal(sanitizePerformanceInstrumentation(evidence), evidence);
    assert.equal(evidence.includes('101'), false);
  }
  console.log('Performance lifecycle contracts passed: retained local process, unchanged cold invocation, launch/PID/instrumentation failures retained.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
