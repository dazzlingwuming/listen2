const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
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

test("macOS release targets remain x64, arm64, and universal DMGs", () => {
  const { dmg, mac } = readJson("package.json").build;
  assert.deepEqual(mac.target, [
    { target: "dmg", arch: ["x64", "arm64", "universal"] },
  ]);
  assert.deepEqual(dmg.window, { width: 760, height: 580 });
});

test("macOS packaging explicitly disables signing and notarization", () => {
  const rootPackage = readJson("package.json");
  assert.equal(rootPackage.build.mac.identity, null);
  assert.equal(rootPackage.build.mac.notarize, false);
  assert.equal(rootPackage.build.mac.sign, undefined);
  assert.equal(rootPackage.build.afterPack, "./build/macInstallHelper.cjs");
  assert.match(
    rootPackage.scripts["dist:mac"],
    /CSC_IDENTITY_AUTO_DISCOVERY=false/
  );
});

test("DMG helper filenames are kept stable for the installation workflow", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/release.yml"),
    "utf8"
  );
  for (const file of [
    "Install Listen1.command",
    "Listen1.integrity.tsv",
    "INSTALL-LISTEN1.txt",
  ]) {
    assert.ok(workflow.includes(file), `workflow must check ${file}`);
  }
  assert.match(workflow, /hdiutil attach -readonly -nobrowse -noautoopen/);
  assert.match(workflow, /LISTEN1-INTEGRITY-1/);
  assert.match(
    workflow,
    /bash "\$mount_dir\/Install Listen1\.command" --verify-only/
  );
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
  assert.match(
    workflow,
    /gh api "repos\/\$GH_REPO\/releases\/tags\/\$RELEASE_TAG"/
  );
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /sha256:\[0-9a-f\]\{64\}/);
  assert.match(workflow, /--clobber/);
  assert.match(workflow, /asset\.name === 'SHA256SUMS\.txt'\) continue/);
});
