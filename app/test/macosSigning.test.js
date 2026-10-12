const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  loadLocalIdentity,
  withKeychainSearchList,
  withKeychainSearchListAsync,
} = require("../../build/setupMacSigning");
const { createSignOptions } = require("../../build/macosSign");
const config = require("../../package.json");

test("macOS builds always use the complete signing hook", () => {
  assert.equal(config.build.mac.sign, "build/macosSign.js");
});

test("ad-hoc signing preserves nested Electron entitlements and binary policy", () => {
  const options = {
    app: "/build/Listen1.app",
    platform: "darwin",
    binaries: ["extra-binary"],
    ignore: () => false,
    optionsForFile: () => ({
      entitlements: "electron-entitlements.plist",
      hardenedRuntime: true,
      additionalArguments: ["--some-existing-option"],
    }),
  };
  const signing = createSignOptions(options, config.build.appId);
  assert.equal(signing.identity, "-");
  assert.equal(signing.identityValidation, false);
  assert.equal(signing.strictVerify, undefined);
  assert.equal(signing.binaries, options.binaries);
  assert.equal(signing.ignore, options.ignore);
  const main = signing.optionsForFile(options.app);
  assert.equal(main.entitlements, "electron-entitlements.plist");
  assert.equal(main.hardenedRuntime, true);
  assert.equal(main.timestamp, "none");
  assert.deepEqual(main.additionalArguments, [
    "--some-existing-option",
    "--identifier",
    config.build.appId,
  ]);
  assert.deepEqual(
    signing.optionsForFile("/build/Listen1.app/Contents/Frameworks/Helper.app")
      .additionalArguments,
    ["--some-existing-option"]
  );
});

test("ad-hoc signing refuses Mac App Store and missing app identifier", () => {
  assert.throws(() =>
    createSignOptions({ platform: "mas" }, "com.example.app")
  );
  assert.throws(() => createSignOptions({ platform: "darwin" }));
});

test("persistent signing preserves the certificate identity and dedicated keychain", () => {
  const localIdentity = {
    identity: "A".repeat(40),
    keychain: "/private/build-only.keychain-db",
  };
  const signing = createSignOptions(
    {
      app: "/build/Listen1.app",
      platform: "darwin",
      optionsForFile: () => ({ hardenedRuntime: true }),
    },
    config.build.appId,
    localIdentity
  );
  assert.equal(signing.identity, localIdentity.identity);
  assert.equal(signing.keychain, localIdentity.keychain);
  assert.equal(
    signing.optionsForFile("/build/Listen1.app").hardenedRuntime,
    true
  );
});

test("local configuration fails closed for partial, malformed, or public material", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "listen2-signing-config-test-")
  );
  fs.chmodSync(directory, 0o700);
  try {
    assert.equal(loadLocalIdentity(directory), null);
    const state = path.join(directory, "setup-state.json");
    fs.writeFileSync(state, "{}", { mode: 0o600 });
    assert.throws(() => loadLocalIdentity(directory), /incomplete/);
    fs.unlinkSync(state);
    const filename = path.join(directory, "identity.json");
    fs.writeFileSync(
      filename,
      JSON.stringify({ version: 1, identity: "A".repeat(40) }),
      { mode: 0o600 }
    );
    assert.deepEqual(loadLocalIdentity(directory), {
      identity: "A".repeat(40),
      keychain: path.join(directory, "build.keychain-db"),
      directory,
    });
    fs.writeFileSync(filename, JSON.stringify({ version: 1, identity: "-" }));
    assert.throws(() => loadLocalIdentity(directory), /Invalid/);
    fs.writeFileSync(
      filename,
      JSON.stringify({ version: 1, identity: "A".repeat(40) })
    );
    fs.chmodSync(filename, 0o644);
    assert.throws(() => loadLocalIdentity(directory), /owner-only/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function mockSearchList(initial) {
  let current = [...initial];
  const writes = [];
  return {
    writes,
    current: () => [...current],
    run(command, args) {
      assert.equal(command, "/usr/bin/security");
      assert.deepEqual(args.slice(0, 3), ["list-keychains", "-d", "user"]);
      if (args[3] === "-s") {
        current = args.slice(4);
        writes.push([...current]);
        return "";
      }
      assert.equal(args.length, 3);
      return current.map((filename) => `    "${filename}"\n`).join("");
    },
  };
}

test("synchronous signing restores the complete ordered search list on success and failure", () => {
  const original = ["/keys/login.keychain-db", "/keys/other.keychain-db"];
  for (const fail of [false, true]) {
    const state = mockSearchList(original);
    const operation = () => {
      assert.deepEqual(state.current(), [
        ...original,
        "/keys/build.keychain-db",
      ]);
      if (fail) throw new Error("signing failed");
      return "signed";
    };
    const execute = () =>
      withKeychainSearchList("/keys/build.keychain-db", operation, state.run);
    if (fail) assert.throws(execute, /signing failed/);
    else assert.equal(execute(), "signed");
    assert.deepEqual(state.current(), original);
    assert.deepEqual(state.writes, [
      [...original, "/keys/build.keychain-db"],
      original,
    ]);
  }
});

test("an existing build keychain is not duplicated or rewritten", async () => {
  const original = ["/keys/build.keychain-db", "/keys/login.keychain-db"];
  const state = mockSearchList(original);
  withKeychainSearchList("/keys/build.keychain-db", () => {}, state.run);
  await withKeychainSearchListAsync(
    "/keys/build.keychain-db",
    async () => {},
    state.run
  );
  assert.deepEqual(state.current(), original);
  assert.deepEqual(state.writes, []);
});

test("async signing serializes scopes and restores after a rejected signing operation", async () => {
  const original = ["/keys/login.keychain-db"];
  const state = mockSearchList(original);
  const events = [];
  let releaseFirst;
  let firstStarted;
  const started = new Promise((resolve) => {
    firstStarted = resolve;
  });
  const first = withKeychainSearchListAsync(
    "/keys/first.keychain-db",
    async () => {
      events.push("first-start");
      firstStarted();
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
      events.push("first-fail");
      throw new Error("first sign failed");
    },
    state.run
  );
  const rejected = assert.rejects(first, /first sign failed/);
  await started;
  const second = withKeychainSearchListAsync(
    "/keys/second.keychain-db",
    async () => {
      events.push("second-start");
      assert.deepEqual(state.current(), [
        ...original,
        "/keys/second.keychain-db",
      ]);
      return "second-signed";
    },
    state.run
  );
  await Promise.resolve();
  assert.deepEqual(events, ["first-start"]);
  releaseFirst();
  await rejected;
  assert.equal(await second, "second-signed");
  assert.deepEqual(events, ["first-start", "first-fail", "second-start"]);
  assert.deepEqual(state.current(), original);
  assert.deepEqual(state.writes, [
    [...original, "/keys/first.keychain-db"],
    original,
    [...original, "/keys/second.keychain-db"],
    original,
  ]);
});

test("malformed search list output fails before any mutation", () => {
  assert.throws(
    () =>
      withKeychainSearchList(
        "/keys/build.keychain-db",
        () => {},
        () => "bad"
      ),
    /safely read/
  );
});

test("a failed search list update is restored before signing can start", () => {
  const original = ["/keys/login.keychain-db"];
  const state = mockSearchList(original);
  let called = false;
  const run = (command, args) => {
    const result = state.run(command, args);
    if (args.includes("/keys/build.keychain-db")) {
      throw new Error("search list update failed");
    }
    return result;
  };
  assert.throws(
    () =>
      withKeychainSearchList(
        "/keys/build.keychain-db",
        () => {
          called = true;
        },
        run
      ),
    /search list update failed/
  );
  assert.equal(called, false);
  assert.deepEqual(state.current(), original);
});

test("a restoration mismatch cannot report signing success", () => {
  const state = mockSearchList(["/keys/login.keychain-db"]);
  const run = (command, args) => {
    if (args[3] === "-s" && args.length === 5) return "";
    return state.run(command, args);
  };
  assert.throws(
    () =>
      withKeychainSearchList("/keys/build.keychain-db", () => "signed", run),
    /restoration failed/
  );
});
