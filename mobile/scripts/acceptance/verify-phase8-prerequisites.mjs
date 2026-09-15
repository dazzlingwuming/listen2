#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const SCRIPT_DIR = resolve(import.meta.dirname);
const MOBILE_ROOT = resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = resolve(MOBILE_ROOT, '..');
const PHASE_DIR = resolve(REPO_ROOT, '.planning/phases/08-integrated-api-35-acceptance-release-like-evidence');
const REQUIRED_PHASES = [
  ['04-official-mobile-shell-unified-provider-registry', 3, 'passed'],
  ['05-five-source-listen-journey', 5, 'complete'],
  ['06-personal-library-continuity', 7, 'passed'],
  ['07-offline-advanced-playback', 5, 'passed'],
];

function fail(message) {
  throw new Error(message);
}

function git(argumentsList) {
  return execFileSync('git', argumentsList, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function normalizedRepoPath(candidate) {
  if (typeof candidate !== 'string' || !candidate || isAbsolute(candidate)) fail('manifest path must be relative');
  if (candidate.includes('\\') || candidate.split('/').includes('..')) fail('manifest path is not normalized');
  const absolute = resolve(REPO_ROOT, candidate);
  if (!absolute.startsWith(`${REPO_ROOT}${sep}`)) fail('manifest path escapes repository');
  return candidate;
}

function loadManifest(path) {
  const manifestPath = resolve(REPO_ROOT, path);
  if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink()) fail('untracked manifest is missing or a symlink');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expectedPhase = '.planning/phases/08-integrated-api-35-acceptance-release-like-evidence';
  if (!manifest || manifest.schemaVersion !== 1 || manifest.phaseDirectory !== expectedPhase || !Array.isArray(manifest.exactFiles) || typeof manifest.runRoot !== 'string')
    fail('untracked manifest has an invalid shape');
  const exact = new Set(manifest.exactFiles.map(normalizedRepoPath));
  if (exact.size !== manifest.exactFiles.length || [...exact].some(entry => !entry.startsWith(`${expectedPhase}/`) || entry.includes('*')))
    fail('untracked manifest has unsafe exact entries');
  const runRoot = normalizedRepoPath(manifest.runRoot);
  if (runRoot !== `${expectedPhase}/evidence`) fail('untracked manifest run root is not canonical');
  return { exact, runRoot };
}

function pathHasSymlink(path) {
  let current = REPO_ROOT;
  for (const part of path.split('/')) {
    current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function isAllowedUntracked(path, manifest) {
  if (!path || path.startsWith('"') || pathHasSymlink(path)) return false;
  if (manifest.exact.has(path)) return true;
  const prefix = `${manifest.runRoot}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length).split('/');
  return /^phase08-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$/.test(rest[0]) && rest.length > 1;
}

function verifyUntracked(manifestPath) {
  const manifest = loadManifest(manifestPath);
  const rows = git(['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean);
  const rejected = [];
  const allowed = [];
  for (const row of rows) {
    if (!row.startsWith('?? ')) continue;
    const path = row.slice(3);
    if (isAllowedUntracked(path, manifest)) allowed.push(path);
    else rejected.push(path || '<malformed>');
  }
  if (rejected.length) fail(`untracked paths are not allow-listed: ${rejected.join(', ')}`);
  return allowed.sort();
}

function phaseFiles(slug) {
  return resolve(REPO_ROOT, '.planning/phases', slug);
}

function requireReport(path, expectedStatus) {
  const body = readFileSync(path, 'utf8');
  if (!new RegExp(`^status: ${expectedStatus}$`, 'm').test(body)) fail(`report is not ${expectedStatus}: ${relative(REPO_ROOT, path)}`);
  return body;
}

function verifyInventories() {
  const roadmap = readFileSync(resolve(REPO_ROOT, '.planning/ROADMAP.md'), 'utf8');
  const requirementText = readFileSync(resolve(REPO_ROOT, '.planning/REQUIREMENTS.md'), 'utf8');
  const reachable = new Set();
  for (const [slug, expectedCount, verificationStatus] of REQUIRED_PHASES) {
    const directory = phaseFiles(slug);
    const plans = Array.from({ length: expectedCount }, (_, index) => resolve(directory, `${slug.slice(0, 2)}-0${index + 1}-PLAN.md`));
    const summaries = Array.from({ length: expectedCount }, (_, index) => resolve(directory, `${slug.slice(0, 2)}-0${index + 1}-SUMMARY.md`));
    if (plans.some(path => !existsSync(path)) || summaries.some(path => !existsSync(path))) fail(`plan/SUMMARY inventory mismatch for ${slug}`);
    const phaseSection = roadmap.slice(roadmap.indexOf(`### Phase ${Number(slug.slice(0, 2))}:`));
    if (!new RegExp(`\\*\\*Plans:\\\*\\* ${expectedCount}/${expectedCount}`).test(phaseSection)) fail(`ROADMAP plan count is not truthful for ${slug}`);
    if (plans.some(path => !roadmap.includes(`- [x] ${path.split('/').pop()}`))) fail(`ROADMAP unchecked plan for ${slug}`);
    const verification = requireReport(resolve(directory, `${slug.slice(0, 2)}-VERIFICATION.md`), verificationStatus);
    const review = requireReport(resolve(directory, `${slug.slice(0, 2)}-REVIEW.md`), 'clean');
    for (const source of [...summaries.map(path => readFileSync(path, 'utf8')), verification, review]) {
      for (const match of source.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
        try {
          execFileSync('git', ['cat-file', '-e', `${match[0]}^{commit}`], { cwd: REPO_ROOT, stdio: 'ignore' });
          reachable.add(match[0]);
        } catch {
          // Evidence prose may mention a non-commit hash; it cannot prove reachability.
        }
      }
    }
    const requirements = [...phaseSection.matchAll(/\b([A-Z]+-\d{3})\b/g)].map(match => match[1]);
    if (!requirements.length || requirements.some(id => !requirementText.includes(id))) fail(`requirement inventory mismatch for ${slug}`);
  }
  for (const commit of reachable) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: REPO_ROOT, stdio: 'ignore' });
    } catch {
      fail(`recorded implementation commit is not reachable from HEAD: ${commit}`);
    }
  }
  const phase7Verification = readFileSync(resolve(phaseFiles('07-offline-advanced-playback'), '07-VERIFICATION.md'), 'utf8');
  const phase7Review = readFileSync(resolve(phaseFiles('07-offline-advanced-playback'), '07-REVIEW.md'), 'utf8');
  const productHead = phase7Verification.match(/product HEAD `([0-9a-f]{7,40})`/);
  if (!productHead || !phase7Review.includes(productHead[1])) fail('Phase 7 review and verification do not name the same product HEAD');
  if (/gaps_remaining:\s*\[\s*[^\]]/m.test(phase7Verification) || /gap(?:s)? (?:remain|remaining)/i.test(phase7Review)) fail('Phase 7 still reports a gap');
}

function selfTest(manifestPath) {
  const manifest = loadManifest(manifestPath);
  const allowed = `${manifest.runRoot}/phase08-20260915T000000Z-0123456789ab/08-build.json`;
  if (!isAllowedUntracked(allowed, manifest)) fail('valid current-run path was rejected');
  if (isAllowedUntracked('.planning/research/.cache/example.json', manifest)) fail('broad planning path was accepted');
  if (isAllowedUntracked(`${manifest.runRoot}/../escape.json`, manifest)) fail('parent path was accepted');
  console.log('Phase 8 untracked manifest self-test passed.');
}

function main() {
  const args = process.argv.slice(2);
  const manifestIndex = args.indexOf('--untracked-manifest');
  const manifestPath = manifestIndex >= 0 ? args[manifestIndex + 1] : 'mobile/scripts/acceptance/untracked-allowlist.json';
  if (!manifestPath) fail('missing untracked manifest');
  if (args.includes('--self-test') || args.includes('--self-test-untracked-manifest')) return selfTest(manifestPath);
  if (!args.includes('--check')) fail('use --check or a self-test flag');
  verifyInventories();
  const allowedUntracked = verifyUntracked(manifestPath);
  const evidence = resolve(MOBILE_ROOT, 'scripts/acceptance/evidence.mjs');
  const run = execFileSync('node', [evidence, '--ensure-current-run', '--phase-dir', relative(REPO_ROOT, PHASE_DIR)], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const prerequisites = resolve(run, '08-prerequisites.json');
  if (!existsSync(prerequisites)) execFileSync('node', [evidence, '--run-dir', run, '--write-prerequisites'], { cwd: REPO_ROOT, stdio: 'inherit' });
  console.log(`Phase 8 prerequisites passed; allowed untracked rows: ${allowedUntracked.length}.`);
}

try {
  main();
} catch (error) {
  console.error(`Phase 8 prerequisite BLOCKED: ${error.message}`);
  process.exitCode = 1;
}
