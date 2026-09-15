#!/usr/bin/env node

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, relative, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const maxFileBytes = 2 * 1024 * 1024;
const maxArtifactBytes = 16 * 1024 * 1024;
const textExtensions = new Set([
  '.java',
  '.js',
  '.json',
  '.kt',
  '.log',
  '.mjs',
  '.txt',
  '.ts',
  '.tsx',
  '.xml',
]);
const ignoredDirectories = new Set([
  '.git',
  '.gradle',
  'build',
  'coverage',
  'node_modules',
  'tmp',
]);
const markerPrefix = ['PHASE7', ''].join('_');
const canaries = [
  ['secret', ['CANARY', 'SECRET']],
  ['cookie', ['CANARY', 'COOKIE']],
  ['signed-transport', ['CANARY', 'SIGNED', 'URL']],
  ['private-path', ['CANARY', 'PRIVATE', 'PATH']],
  ['full-lyric', ['CANARY', 'FULL', 'LYRIC']],
  ['raw-model', ['CANARY', 'RAW', 'MODEL']],
];

function usage() {
  console.error(
    'Usage: node scripts/verify-phase7-security.mjs [unpacked-artifact-path]',
  );
}

function fileIsIncluded(file, artifactMode) {
  const extension = extname(file).toLowerCase();
  return (
    textExtensions.has(extension) ||
    (artifactMode && basename(file).toLowerCase().endsWith('.apk'))
  );
}

function collect(root, artifactMode, files = []) {
  if (!existsSync(root)) throw new Error('security scan path is missing');
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) return files;
  if (stat.isFile()) {
    if (
      fileIsIncluded(root, artifactMode) &&
      stat.size <= (artifactMode ? maxArtifactBytes : maxFileBytes)
    )
      files.push(root);
    return files;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    collect(resolve(root, entry.name), artifactMode, files);
  }
  return files;
}

function finding(kind, file) {
  return `${kind}:${relative(packageRoot, file) || basename(file)}`;
}

function scanFile(file) {
  const bytes = readFileSync(file);
  const source = bytes.toString('utf8');
  const findings = [];
  for (const [kind, suffix] of canaries) {
    if (source.includes(markerPrefix + suffix.join('_')))
      findings.push(finding(kind, file));
  }
  if (source.includes(['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')))
    findings.push(finding('private-key', file));
  return findings;
}

function productionFiles() {
  const roots = [
    resolve(packageRoot, 'src'),
    resolve(packageRoot, 'android/app/src/main'),
  ];
  return roots
    .flatMap(root => collect(root, false))
    .filter(file => !file.includes('/__tests__/'));
}

function requireAbsent(files, token, kind, findings) {
  for (const file of files) {
    if (readFileSync(file, 'utf8').includes(token))
      findings.push(finding(kind, file));
  }
}

function contractFindings() {
  const findings = [];
  const files = productionFiles();
  requireAbsent(files, 'BootstrapTrack', 'raw-playback-contract', findings);
  requireAbsent(files, 'downloadSlice', 'legacy-download-chain', findings);

  const bridge = resolve(packageRoot, 'src/api/nativePlayback.ts');
  if (!existsSync(bridge) || readFileSync(bridge, 'utf8').includes('headers')) {
    findings.push(finding('raw-playback-contract', bridge));
  }

  const offlineCore = resolve(
    packageRoot,
    'android/app/src/main/java/com/listen2mobile/offline/OfflineCore.kt',
  );
  if (!existsSync(offlineCore)) {
    findings.push(finding('offline-resolver-missing', offlineCore));
  } else {
    const source = readFileSync(offlineCore, 'utf8');
    const resolver = source.match(
      /fun resolve\(source: String, trackId: String\)[\s\S]*?\n    fun file/,
    );
    if (!resolver || resolver[0].includes('.part'))
      findings.push(finding('player-addressable-partial', offlineCore));
  }
  return findings;
}

function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.length > 1 || argumentsList[0] === '--help') {
    usage();
    process.exit(argumentsList[0] === '--help' ? 0 : 2);
  }
  const artifactRoot = argumentsList[0]
    ? resolve(process.cwd(), argumentsList[0])
    : null;
  const roots = artifactRoot
    ? [artifactRoot]
    : [
        resolve(packageRoot, 'src'),
        resolve(packageRoot, 'android/app/src/main'),
        resolve(packageRoot, 'scripts'),
      ];
  const findings = roots.flatMap(root =>
    collect(root, Boolean(artifactRoot)).flatMap(scanFile),
  );
  if (!artifactRoot) findings.push(...contractFindings());
  if (findings.length > 0) {
    for (const result of [...new Set(findings)].sort())
      console.error(
        `Phase 7 security finding [${result.split(':')[0]}] ${result
          .split(':')
          .slice(1)
          .join(':')}`,
      );
    process.exit(1);
  }
  console.log(
    'Phase 7 security scan passed. APK extraction and runtime log inspection remain Phase 8 evidence.',
  );
}

main();
