const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");
const test = require("node:test");
const helper = require("../../build/macInstallHelper.cjs");
const repo = path.resolve(__dirname, "../..");
const scratch = path.join(
  repo,
  ".task-workspaces/macos-daily-theme-20261025/scratch/mac-installer"
);
const native = process.platform === "darwin";

function fixture(t) {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, "fixture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const disk = path.join(root, "download disk");
  const app = path.join(disk, "Listen1.app");
  fs.mkdirSync(path.join(app, "Contents/MacOS"), { recursive: true });
  fs.mkdirSync(path.join(app, "Contents/Resources/Versions/A"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(app, "Contents/Resources/Versions/A/resource"),
    "fixture payload\n"
  );
  fs.symlinkSync("A", path.join(app, "Contents/Resources/Versions/Current"));
  fs.symlinkSync(
    "Versions/Current/resource",
    path.join(app, "Contents/Resources/resource")
  );
  fs.copyFileSync(
    path.join(
      repo,
      "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
    ),
    path.join(app, "Contents/MacOS/Listen1")
  );
  fs.chmodSync(path.join(app, "Contents/MacOS/Listen1"), 0o755);
  const plist = path.join(app, "Contents/Info.plist");
  fs.writeFileSync(
    plist,
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.listen1.listen1</string><key>CFBundleShortVersionString</key><string>2.35.7</string><key>CFBundleExecutable</key><string>Listen1</string></dict></plist>'
  );
  helper.generate(app, "2.35.7");
  return {
    root,
    disk,
    app,
    plist,
    script: path.join(disk, "Install Listen1.command"),
  };
}
function run(f, args = ["--verify-only"], input) {
  const result = spawnSync("/bin/bash", [f.script, ...args], {
    encoding: "utf8",
    input,
  });
  return { ...result, text: result.stdout + result.stderr };
}
function installFixture(f, options = {}) {
  // Test-only source rewriting confines every mutation to this registered fixture.
  // Production helper has no destination/tool/failure environment overrides.
  const applications = path.join(f.root, "Applications");
  const home = path.join(f.root, "home");
  fs.mkdirSync(applications);
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(home, "Library/Application Support/Listen1"), {
    recursive: true,
  });
  const config = path.join(home, "Library/Application Support/Listen1/config");
  fs.writeFileSync(config, "keep settings");
  let script = fs
    .readFileSync(f.script, "utf8")
    .replace('home=$(cd -P -- "$HOME" && pwd)', `home='${home}'`)
    .replace("system_apps=/Applications", `system_apps='${applications}'`)
    .replace(
      "/bin/ps -axo comm=",
      options.running
        ? `printf '%s\\n' '${applications}/Listen1.app/Contents/MacOS/Listen1'`
        : "printf ''"
    );
  if (options.failReplace)
    script = script.replace(
      '/bin/mv "$stage/Listen1.app" "$destination"',
      "/usr/bin/false # simulated atomic replacement failure"
    );
  if (options.failFinalVerify)
    script = script.replace(
      'verify_bundle "$destination"\nsuccess=1',
      "/usr/bin/false # simulated final verification failure\nsuccess=1"
    );
  fs.writeFileSync(f.script, script);
  return {
    applications,
    destination: path.join(applications, "Listen1.app"),
    config,
  };
}

test(
  "native helper verifies all files, modes and internal Electron-style symlinks without mutation",
  { skip: !native },
  (t) => {
    const f = fixture(t);
    const before = fs.readdirSync(f.root);
    const result = run(f);
    assert.equal(result.status, 0, result.text);
    assert.match(result.text, /integrity verified/);
    assert.deepEqual(fs.readdirSync(f.root), before);
  }
);

for (const [name, change, expected] of [
  [
    "file tamper",
    (f) =>
      fs.appendFileSync(
        path.join(f.app, "Contents/Resources/Versions/A/resource"),
        "tampered"
      ),
    /hash mismatch/,
  ],
  [
    "permission tamper",
    (f) => fs.chmodSync(path.join(f.app, "Contents/MacOS/Listen1"), 0o644),
    /Permission mismatch/,
  ],
  [
    "extra file",
    (f) => fs.writeFileSync(path.join(f.app, "unexpected"), "extra"),
    /Unexpected bundle entries/,
  ],
  [
    "changed link",
    (f) => {
      fs.unlinkSync(path.join(f.app, "Contents/Resources/resource"));
      fs.symlinkSync("/tmp", path.join(f.app, "Contents/Resources/resource"));
    },
    /Link mismatch/,
  ],
  [
    "wrong version",
    (f) =>
      fs.writeFileSync(
        f.plist,
        fs.readFileSync(f.plist, "utf8").replace("2.35.7", "9.0.0")
      ),
    /Wrong application version/,
  ],
  [
    "manifest tamper",
    (f) => fs.appendFileSync(path.join(f.disk, "Listen1.integrity.tsv"), "\n"),
    /manifest has changed/,
  ],
  [
    "source app link",
    (f) => {
      const moved = path.join(f.root, "other.app");
      fs.renameSync(f.app, moved);
      fs.symlinkSync(moved, f.app);
    },
    /real directory/,
  ],
]) {
  test(`native helper refuses ${name}`, { skip: !native }, (t) => {
    const f = fixture(t);
    change(f);
    const result = run(f);
    assert.notEqual(result.status, 0, result.text);
    assert.match(result.text, expected);
  });
}

test(
  "manifest generation refuses escaping symlinks and incorrect bundle identity",
  { skip: !native },
  (t) => {
    const f = fixture(t);
    fs.symlinkSync("/tmp", path.join(f.app, "escape"));
    assert.throws(() => helper.manifestFor(f.app, "2.35.7"), /symlink/i);
    fs.unlinkSync(path.join(f.app, "escape"));
    assert.throws(
      () => helper.manifestFor(f.app, "0.0.0"),
      /identity\/version/
    );
  }
);

test(
  "native installer stages, removes only quarantine, retains previous app and preserves settings",
  { skip: !native },
  (t) => {
    const f = fixture(t);
    const paths = installFixture(f);
    execFileSync("/usr/bin/ditto", [f.app, paths.destination]);
    fs.writeFileSync(
      path.join(paths.destination, "old-version-marker"),
      "old app"
    );
    execFileSync("/usr/bin/xattr", [
      "-w",
      "com.apple.quarantine",
      "0081;fixture;Listen1;",
      f.app,
    ]);
    execFileSync("/usr/bin/xattr", [
      "-w",
      "org.listen1.test-preserved",
      "preserve",
      f.app,
    ]);
    const result = run(f, [], "INSTALL\n");
    assert.equal(result.status, 0, result.text);
    assert.equal(fs.readFileSync(paths.config, "utf8"), "keep settings");
    assert.equal(
      fs.existsSync(path.join(paths.destination, "old-version-marker")),
      false
    );
    const backup = fs
      .readdirSync(paths.applications)
      .find((name) => name.startsWith(".Listen1-backup."));
    assert.ok(backup);
    assert.equal(
      fs.readFileSync(
        path.join(paths.applications, backup, "Listen1.app/old-version-marker"),
        "utf8"
      ),
      "old app"
    );
    assert.equal(
      execFileSync(
        "/usr/bin/xattr",
        ["-p", "org.listen1.test-preserved", paths.destination],
        { encoding: "utf8" }
      ).trim(),
      "preserve"
    );
    assert.notEqual(
      spawnSync("/usr/bin/xattr", [
        "-p",
        "com.apple.quarantine",
        paths.destination,
      ]).status,
      0
    );
    assert.equal(
      execFileSync("/usr/bin/xattr", ["-p", "com.apple.quarantine", f.app], {
        encoding: "utf8",
      }).trim(),
      "0081;fixture;Listen1;"
    );
    assert.ok(
      !fs
        .readdirSync(paths.applications)
        .some((name) => name.startsWith(".Listen1-install."))
    );
  }
);

test(
  "native installer refuses running Listen1 before confirmation or staging",
  { skip: !native },
  (t) => {
    const f = fixture(t);
    const paths = installFixture(f, { running: true });
    const result = run(f, [], "INSTALL\n");
    assert.notEqual(result.status, 0);
    assert.match(result.text, /Quit Listen1/);
    assert.deepEqual(fs.readdirSync(paths.applications), []);
  }
);

test("native installer cancels without installing", { skip: !native }, (t) => {
  const f = fixture(t);
  const paths = installFixture(f);
  const result = run(f, [], "no\n");
  assert.notEqual(result.status, 0);
  assert.match(result.text, /cancelled/);
  assert.deepEqual(fs.readdirSync(paths.applications), []);
});

test(
  "native installer refuses duplicate installations and symlink destinations",
  { skip: !native },
  (t) => {
    const f = fixture(t);
    const paths = installFixture(f);
    execFileSync("/usr/bin/ditto", [f.app, paths.destination]);
    const userApp = path.join(f.root, "home/Applications/Listen1.app");
    fs.mkdirSync(path.dirname(userApp));
    fs.symlinkSync(f.app, userApp);
    assert.match(run(f, [], "INSTALL\n").text, /both Applications folders/);
    fs.rmSync(paths.destination, { recursive: true });
    assert.match(run(f, [], "INSTALL\n").text, /symbolic link/);
    assert.equal(fs.readlinkSync(userApp), f.app);
  }
);

test(
  "native installer removes failed first installation without touching settings",
  { skip: !native },
  (t) => {
    const f = fixture(t);
    const paths = installFixture(f, { failFinalVerify: true });
    const result = run(f, [], "INSTALL\n");
    assert.notEqual(result.status, 0);
    assert.deepEqual(fs.readdirSync(paths.applications), []);
    assert.equal(fs.readFileSync(paths.config, "utf8"), "keep settings");
  }
);

test(
  "native installer restores old app after failed final verification",
  { skip: !native },
  (t) => {
    const f = fixture(t);
    const paths = installFixture(f, { failFinalVerify: true });
    execFileSync("/usr/bin/ditto", [f.app, paths.destination]);
    fs.writeFileSync(path.join(paths.destination, "old-marker"), "recover me");
    const result = run(f, [], "INSTALL\n");
    assert.notEqual(result.status, 0);
    assert.match(result.text, /Previous Listen1 restored/);
    assert.equal(
      fs.readFileSync(path.join(paths.destination, "old-marker"), "utf8"),
      "recover me"
    );
    assert.deepEqual(fs.readdirSync(paths.applications), ["Listen1.app"]);
  }
);

test(
  "native installer rolls back an atomic replacement failure",
  { skip: !native },
  (t) => {
    const f = fixture(t);
    const paths = installFixture(f, { failReplace: true });
    execFileSync("/usr/bin/ditto", [f.app, paths.destination]);
    fs.writeFileSync(path.join(paths.destination, "old-marker"), "recover me");
    const result = run(f, [], "INSTALL\n");
    assert.notEqual(result.status, 0);
    assert.match(result.text, /Previous Listen1 restored/);
    assert.equal(
      fs.readFileSync(path.join(paths.destination, "old-marker"), "utf8"),
      "recover me"
    );
    assert.deepEqual(fs.readdirSync(paths.applications), ["Listen1.app"]);
  }
);

test("DMG sidecars are architecture-local without changing shared target options", async () => {
  const captured = [];
  const target = {
    name: "dmg",
    options: { contents: [{ x: 1, y: 1 }] },
    async build(appPath) {
      captured.push({ appPath, contents: this.options.contents });
    },
  };
  helper.attachDmgFiles(target);
  helper.attachDmgFiles(target);
  await Promise.all([
    target.build("/output/mac-arm64/Listen1.app", 3),
    target.build("/output/mac/Listen1.app", 1),
  ]);
  assert.equal(target.options.contents.length, 1);
  for (const entry of captured) {
    assert.equal(entry.contents.length, 4);
    for (const sidecar of entry.contents.slice(1))
      assert.equal(path.dirname(sidecar.path), path.dirname(entry.appPath));
  }
});

test("production helper has one app-specific quarantine operation and no privilege/signing/policy commands", () => {
  const script = fs.readFileSync(
    path.join(repo, "build/mac-install/install.sh"),
    "utf8"
  );
  assert.deepEqual(
    script.split("\n").filter((line) => /^\/usr\/bin\/xattr/.test(line)),
    ['/usr/bin/xattr -dr com.apple.quarantine "$stage/Listen1.app"']
  );
  assert.doesNotMatch(
    script,
    /(?:^|\n)\s*(?:sudo|codesign|spctl|security|xcrun|kill|killall)\s/
  );
  assert.doesNotMatch(script, /LISTEN1_(?:DEST|TEST|SKIP|FORCE)/);
  assert.ok(
    script.indexOf('if [ "${1:-}" = --verify-only ]; then exit 0; fi') <
      script.indexOf("system_apps=/Applications")
  );
});
