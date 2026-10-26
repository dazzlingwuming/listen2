#!/usr/bin/env node
"use strict";

// Candidate acceptance only: reads DMGs without launching/installing the app.
// CLI: node scripts/verify-mac-artifacts.cjs --dist-dir dist --output dist/acceptance.json
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const yaml = require("js-yaml");

const root = path.resolve(__dirname, "..");
const sourceFiles = Object.freeze([
  "app/listen1_chrome_extension/listen1.html",
  "app/listen1_chrome_extension/css/redesign.css",
  "app/listen1_chrome_extension/css/theme-collection.css",
  "app/listen1_chrome_extension/js/controller/play.js",
  "app/main.js",
  "app/dailyWallpaper.js",
  "app/listen1_chrome_extension/js/daily_theme.js",
]);
const manifestSourceFile = "app/package.json";
// app-builder-lib 25.1.8 out/fileTransformer.js removes these by default.
// Keep this independent, narrow contract instead of calling its transformer.
const allowedRemovedManifestFields = Object.freeze(["scripts", "keywords"]);
const architectures = Object.freeze({
  x64: ["x86_64"],
  arm64: ["arm64"],
  universal: ["arm64", "x86_64"],
});

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${JSON.stringify(args)}: ${
        result.error?.message || result.stderr || result.stdout
      }`
    );
  }
  return result.stdout.trim();
}
function digest(bytes, algorithm = "sha256", encoding = "hex") {
  return crypto.createHash(algorithm).update(bytes).digest(encoding);
}
function realFile(file) {
  const stat = fs.lstatSync(file);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0,
    `Expected nonempty real file: ${file}`
  );
  return stat;
}
function metadata(file) {
  const stat = realFile(file);
  return {
    name: path.basename(file),
    sizeBytes: stat.size,
    sha256: digest(fs.readFileSync(file)),
  };
}
function verifyManifest(sourceBytes, bundledBytes, expectedVersion) {
  const source = JSON.parse(sourceBytes.toString("utf8"));
  const bundled = JSON.parse(bundledBytes.toString("utf8"));
  for (const manifest of [source, bundled]) {
    assert.ok(
      manifest && typeof manifest === "object" && !Array.isArray(manifest)
    );
    for (const field of ["name", "version", "main"]) {
      assert.ok(
        typeof manifest[field] === "string" && manifest[field].length > 0,
        `Invalid manifest ${field}`
      );
    }
    assert.equal(
      manifest.version,
      expectedVersion,
      "Manifest version mismatch"
    );
  }
  const expected = { ...source };
  const removedFields = [];
  for (const field of allowedRemovedManifestFields) {
    if (Object.hasOwn(source, field) && !Object.hasOwn(bundled, field)) {
      delete expected[field];
      removedFields.push(field);
    }
  }
  // Every remaining property, including name/main/dependencies, is exact JSON.
  // An allowed field may be absent, but cannot be modified or newly added.
  assert.deepEqual(
    bundled,
    expected,
    "ASAR manifest structure mismatch outside permitted field removal"
  );
  return {
    file: manifestSourceFile,
    version: bundled.version,
    sourceSha256: digest(sourceBytes),
    bundledSha256: digest(bundledBytes),
    byteMatch: sourceBytes.equals(bundledBytes),
    allowedRemovedFields: [...allowedRemovedManifestFields],
    removedFields,
    structureMatch: true,
  };
}
function verifyAsar(archive, expectedVersion) {
  realFile(archive);
  const files = sourceFiles.map((file) => {
    const source = fs.readFileSync(path.join(root, file));
    const bundled = asar.extractFile(archive, file.replace(/^app\//, ""));
    const match = source.equals(bundled);
    assert.ok(match, `ASAR/source mismatch: ${file}`);
    return {
      file,
      match,
      sha256: digest(source),
      bundledSha256: digest(bundled),
    };
  });
  const manifest = verifyManifest(
    fs.readFileSync(path.join(root, manifestSourceFile)),
    asar.extractFile(archive, "package.json"),
    expectedVersion
  );
  return {
    appVersion: manifest.version,
    allSourceFilesMatch: true,
    fileCount: files.length,
    files,
    manifest,
  };
}
function plistField(file, key) {
  return run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, file]);
}
function verifyDmg(image, arch, pkg, version) {
  const artifact = metadata(image);
  run("hdiutil", ["verify", image]);
  const mount = fs.mkdtempSync(
    path.join(process.env.RUNNER_TEMP || os.tmpdir(), `listen1-verify-${arch}-`)
  );
  let attached = false;
  try {
    run("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-noautoopen",
      "-mountpoint",
      mount,
      image,
    ]);
    attached = true;
    const volumeContents = fs.readdirSync(mount).sort();
    const appName = `${pkg.build.productName}.app`;
    assert.deepEqual(
      volumeContents.filter((name) => !name.startsWith(".")),
      ["Applications", appName].sort(),
      "Expected plain app + Applications DMG"
    );
    const app = path.join(mount, appName);
    assert.ok(
      fs.lstatSync(app).isDirectory() && !fs.lstatSync(app).isSymbolicLink(),
      "App must be a real directory"
    );
    const applications = path.join(mount, "Applications");
    assert.ok(
      fs.lstatSync(applications).isSymbolicLink(),
      "Missing Applications link"
    );
    assert.equal(fs.readlinkSync(applications), "/Applications");
    for (const name of [
      "Install Listen1.command",
      "INSTALL-LISTEN1.txt",
      "Listen1.integrity.tsv",
    ]) {
      assert.ok(
        !volumeContents.includes(name),
        `Unexpected installation helper: ${name}`
      );
    }
    const plist = path.join(app, "Contents/Info.plist");
    assert.equal(plistField(plist, "CFBundleShortVersionString"), version);
    assert.equal(plistField(plist, "CFBundleVersion"), version);
    assert.equal(plistField(plist, "CFBundleIdentifier"), pkg.build.appId);
    assert.equal(plistField(plist, "CFBundleExecutable"), "Listen1");
    const executable = path.join(app, "Contents/MacOS/Listen1");
    assert.ok(
      realFile(executable).mode & 0o111,
      "Main executable must be executable"
    );
    const actualArches = run("lipo", ["-archs", executable])
      .split(/\s+/)
      .sort();
    assert.deepEqual(actualArches, architectures[arch]);
    const source = verifyAsar(
      path.join(app, "Contents/Resources/app.asar"),
      version
    );
    return {
      ...artifact,
      version,
      bundleId: pkg.build.appId,
      architectures: actualArches,
      volumeContents,
      plainAppApplicationsLayout: true,
      noHelperEntries: true,
      asar: source,
    };
  } finally {
    // A detach failure is fatal and leaves its mount path in the error for recovery.
    if (attached) run("hdiutil", ["detach", mount]);
    fs.rmdirSync(mount);
  }
}
function verifyLatest(dist, version) {
  const latest = yaml.load(
    fs.readFileSync(path.join(dist, "latest-mac.yml"), "utf8")
  );
  assert.equal(latest.version, version);
  assert.ok(Array.isArray(latest.files));
  const expectedNames = Object.keys(architectures)
    .map((arch) => `listen1_${version}_mac_${arch}.dmg`)
    .sort();
  assert.deepEqual(
    latest.files.map((file) => file.url).sort(),
    expectedNames,
    "Unexpected latest-mac files"
  );
  for (const file of latest.files) {
    const bytes = fs.readFileSync(path.join(dist, file.url));
    assert.equal(
      file.size,
      bytes.length,
      `latest-mac size mismatch: ${file.url}`
    );
    assert.equal(
      file.sha512,
      digest(bytes, "sha512", "base64"),
      `latest-mac digest mismatch: ${file.url}`
    );
  }
  assert.ok(expectedNames.includes(latest.path), "Invalid latest-mac path");
  assert.equal(
    latest.sha512,
    latest.files.find((file) => file.url === latest.path).sha512
  );
}
function main() {
  const options = { "--dist-dir": "dist", "--output": "dist/acceptance.json" };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(
      Object.hasOwn(options, args[i]) && args[i + 1],
      "Use --dist-dir <directory> --output <acceptance.json>"
    );
    options[args[i]] = args[i + 1];
  }
  const dist = path.resolve(root, options["--dist-dir"]);
  const output = path.resolve(root, options["--output"]);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  );
  const appPkg = JSON.parse(
    fs.readFileSync(path.join(root, "app/package.json"), "utf8")
  );
  const version = pkg.version;
  assert.equal(
    version,
    "2.35.7",
    "This approved candidate channel is restricted to v2.35.7"
  );
  assert.equal(appPkg.version, version);
  assert.equal(pkg.build.appId, "com.listen1.listen1");
  assert.equal(
    pkg.build.mac.identity,
    null,
    "Expected existing explicit unsigned identity"
  );
  assert.equal(
    process.env.CSC_IDENTITY_AUTO_DISCOVERY,
    "false",
    "Expected existing signing discovery setting"
  );
  const sourceCommit = run("git", ["rev-parse", "HEAD"]);
  const sourceTree = run("git", ["rev-parse", "HEAD^{tree}"]);
  assert.match(sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(sourceTree, /^[0-9a-f]{40}$/);
  if (process.env.GITHUB_SHA)
    assert.equal(sourceCommit, process.env.GITHUB_SHA);
  assert.equal(
    run("git", [
      "status",
      "--porcelain",
      "--untracked-files=no",
      "--",
      "package.json",
      manifestSourceFile,
      ...sourceFiles,
    ]),
    "",
    "Candidate source differs from recorded commit"
  );
  // An incomplete run must never leave a prior success report eligible for upload.
  assert.ok(
    !fs.existsSync(output),
    `Acceptance already exists; use a fresh build/output path: ${output}`
  );
  const artifactNames = [
    ...Object.keys(architectures).flatMap((arch) => [
      `listen1_${version}_mac_${arch}.dmg`,
      `listen1_${version}_mac_${arch}.dmg.blockmap`,
    ]),
    "latest-mac.yml",
  ];
  for (const name of artifactNames) realFile(path.join(dist, name));
  verifyLatest(dist, version);
  const dmgs = Object.keys(architectures).map((arch) =>
    verifyDmg(
      path.join(dist, `listen1_${version}_mac_${arch}.dmg`),
      arch,
      pkg,
      version
    )
  );
  const artifacts = artifactNames.map((name) =>
    metadata(path.join(dist, name))
  );
  for (const dmg of dmgs)
    assert.deepEqual(
      { name: dmg.name, sizeBytes: dmg.sizeBytes, sha256: dmg.sha256 },
      artifacts.find((a) => a.name === dmg.name),
      "DMG changed during verification"
    );
  assert.equal(run("git", ["rev-parse", "HEAD"]), sourceCommit);
  assert.equal(run("git", ["rev-parse", "HEAD^{tree}"]), sourceTree);
  assert.equal(
    run("git", [
      "status",
      "--porcelain",
      "--untracked-files=no",
      "--",
      "package.json",
      manifestSourceFile,
      ...sourceFiles,
    ]),
    "",
    "Candidate source changed during verification"
  );
  const acceptance = {
    verified: true,
    version,
    rootVersion: pkg.version,
    appVersion: appPkg.version,
    bundleId: pkg.build.appId,
    sourceCommit,
    sourceTree,
    verifiedSourceFilesDirty: false,
    verifiedAt: new Date().toISOString(),
    dmgs,
    artifacts,
    installationOrLaunchVerified: false,
    gatekeeperStatus: "unresolved",
    uiAcceptance: {
      scope: "container, bundle and ASAR source checks only; no UI execution",
      currentUserAppUpdated: false,
    },
    limits: [
      "No installation, launch or real user download/Gatekeeper acceptance was tested.",
      "Seven runtime source files are compared byte for byte; app/package.json uses a separate strict JSON contract allowing only removal of scripts/keywords.",
      "UI visual/interaction acceptance is a separate task; this report binds the packaged bytes and manifest structure to the recorded commit.",
    ],
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(acceptance, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify(
      {
        verified: true,
        acceptance: output,
        version,
        sourceCommit,
        sourceTree,
        artifactCount: artifacts.length,
        dmgCount: dmgs.length,
        sourceFileCount: sourceFiles.length,
      },
      null,
      2
    )
  );
}
module.exports = { sourceFiles, verifyAsar, verifyManifest };
if (require.main === module) main();
