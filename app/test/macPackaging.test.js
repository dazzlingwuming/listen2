const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const V2_35_1_PACKAGING_SOURCE =
  "v2.35.1, commit 59af26855d75bd94fea3c34a632721ed90ced65f";
const V2_35_1_DIST_MAC =
  "CSC_IDENTITY_AUTO_DISCOVERY=false DEBUG=electron-builder electron-builder --mac dmg --x64 --arm64 --universal";
const V2_35_1_DMG = {
  icon: "build/disk.icns",
  contents: [
    { x: 192, y: 344 },
    { x: 448, y: 344, type: "link", path: "/Applications" },
  ],
};
const V2_35_1_MAC = {
  target: [{ target: "dmg", arch: ["x64", "arm64", "universal"] }],
  category: "public.app-category.music",
};
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

test("desktop package versions are aligned for the 2.35.7 release", () => {
  for (const relativePath of [
    "package.json",
    "app/package.json",
    "package-lock.json",
    "app/package-lock.json",
  ]) {
    const pkg = readJson(relativePath);
    assert.equal(pkg.version, "2.35.7", relativePath);
    if (pkg.lockfileVersion) {
      assert.equal(pkg.packages[""].version, "2.35.7", `${relativePath} root`);
    }
  }
});

test(`macOS packaging exactly matches archived ${V2_35_1_PACKAGING_SOURCE}`, () => {
  const rootPackage = readJson("package.json");
  assert.deepEqual(rootPackage.build.dmg, V2_35_1_DMG);
  assert.deepEqual(rootPackage.build.mac, V2_35_1_MAC);
  assert.equal(rootPackage.scripts["dist:mac"], V2_35_1_DIST_MAC);
  assert.equal(rootPackage.build.afterPack, undefined);
});

test("DMG workflow validates plain app drag-and-drop without a helper routine", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/release.yml"),
    "utf8"
  );
  assert.match(workflow, /hdiutil attach -readonly -nobrowse -noautoopen/);
  assert.match(workflow, /Applications link in \$image/);
  assert.match(workflow, /com\.listen1\.listen1/);
  assert.match(workflow, /CFBundleShortVersionString/);
  assert.match(workflow, /lipo -archs/);
  assert.match(workflow, /Unexpected installation helper in plain DMG/);
  assert.doesNotMatch(workflow, /--verify-only|codesign|spctl|xattr/);
});

test("GitHub macOS release build keeps identity auto-discovery disabled", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/release.yml"),
    "utf8"
  );
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.doesNotMatch(workflow, /APPLE_ID:|APPLE_TEAM_ID:|APPLE_API_KEY:/);
});

test("release publishing generates checksums from GitHub asset digests", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/release.yml"),
    "utf8"
  );
  assert.match(workflow, /gh api "repos\/\$GH_REPO\/releases\/\$release_id"/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /sha256:\[0-9a-f\]\{64\}/);
  assert.match(workflow, /--clobber/);
  assert.match(workflow, /asset\.name === 'SHA256SUMS\.txt'\) continue/);
});

function getReleaseIdLookupScript() {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/release.yml"),
    "utf8"
  );
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line.trim() === "# BEGIN release ID lookup"
  );
  const end = lines.findIndex(
    (line) => line.trim() === "# END release ID lookup"
  );
  assert.ok(
    start >= 0 && end > start,
    "workflow must bracket the release ID lookup"
  );
  return lines
    .slice(start + 1, end)
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

function withFakeGh(releaseId, callback) {
  const fixtureParent = path.join(
    root,
    ".task-workspaces/macos-direct-install-20261025/scratch"
  );
  fs.mkdirSync(fixtureParent, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(
    path.join(fixtureParent, "listen1-release-lookup-")
  );
  const bin = path.join(fixtureRoot, "bin");
  fs.mkdirSync(bin);
  const apiLog = path.join(fixtureRoot, "api-calls.txt");
  const fakeGh = path.join(bin, "gh");
  fs.writeFileSync(
    fakeGh,
    `#!/bin/sh
set -eu
if [ "$1" = "release" ]; then
  [ "$2" = "view" ] && [ "$3" = "$RELEASE_TAG" ] && [ "$4" = "--repo" ] && [ "$5" = "$GH_REPO" ] && [ "$6" = "--json" ] && [ "$7" = "databaseId" ] && [ "$8" = "--jq" ] && [ "$9" = ".databaseId" ]
  printf '%s' "$FAKE_RELEASE_ID"
elif [ "$1" = "api" ]; then
  printf '%s\\n' "$2" >> "$FAKE_API_LOG"
  case "$2" in
    "repos/fixture/listen2/releases/42") printf '%s\\n' '{"assets":[{"name":"sample.dmg","size":123,"digest":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}]}' ;;
    "repos/fixture/listen2/releases/tags/v2.35.7") echo 'Not Found' >&2; exit 1 ;;
    *) echo "Unexpected API path: $2" >&2; exit 2 ;;
  esac
else
  echo "Unexpected gh command: $*" >&2
  exit 3
fi
`,
    { mode: 0o755 }
  );
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    GH_REPO: "fixture/listen2",
    RELEASE_TAG: "v2.35.7",
    RUNNER_TEMP: fixtureRoot,
    FAKE_RELEASE_ID: releaseId,
    FAKE_API_LOG: apiLog,
  };
  try {
    callback({ env, fixtureRoot, apiLog });
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test("draft release lookup uses gh CLI ID then numeric REST path", () => {
  withFakeGh("42", ({ env, fixtureRoot, apiLog }) => {
    const script = getReleaseIdLookupScript();
    const result = spawnSync("bash", ["-c", script], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.readFileSync(apiLog, "utf8").trim(),
      "repos/fixture/listen2/releases/42"
    );
    const release = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, "release.json"), "utf8")
    );
    assert.equal(release.assets[0].name, "sample.dmg");

    const tagLookup = spawnSync(
      "bash",
      ["-c", 'gh api "repos/$GH_REPO/releases/tags/$RELEASE_TAG"'],
      { env, encoding: "utf8" }
    );
    assert.notEqual(
      tagLookup.status,
      0,
      "draft tag REST lookup must return 404"
    );
    assert.match(fs.readFileSync(apiLog, "utf8"), /releases\/tags\/v2\.35\.7/);
  });
});

test("release lookup rejects a nonnumeric release ID before REST access", () => {
  withFakeGh("42oops", ({ env, fixtureRoot, apiLog }) => {
    const result = spawnSync("bash", ["-c", getReleaseIdLookupScript()], {
      env,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid GitHub release ID/);
    assert.equal(fs.existsSync(apiLog), false);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "release.json")), false);
  });
});
