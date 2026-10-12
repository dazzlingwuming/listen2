const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const SIGNING_DIRECTORY = path.join(
  os.homedir(),
  "Library/Application Support/Listen2BuildSigning"
);
const KEYCHAIN_HELPER = `import Foundation
import Security

func fail(_ status: OSStatus) -> Never {
    FileHandle.standardError.write(Data("Build keychain operation failed: \\(status)\\n".utf8))
    exit(1)
}
func check(_ status: OSStatus) { if status != errSecSuccess { fail(status) } }
let data = FileHandle.standardInput.readDataToEndOfFile()
guard let input = try JSONSerialization.jsonObject(with: data) as? [String: String],
      let action = input["action"], let location = input["keychain"],
      let password = input["password"] else { fail(errSecParam) }
check(SecKeychainSetUserInteractionAllowed(false))
var keychain: SecKeychain?
let passwordBytes = Array(password.utf8)
if action == "create" {
    check(passwordBytes.withUnsafeBytes { bytes in
        SecKeychainCreate(location, UInt32(bytes.count), bytes.baseAddress, false, nil, &keychain)
    })
} else {
    check(SecKeychainOpen(location, &keychain))
}
guard let keychain = keychain else { fail(errSecInvalidKeychain) }
check(passwordBytes.withUnsafeBytes { bytes in
    SecKeychainUnlock(keychain, UInt32(bytes.count), bytes.baseAddress, true)
})
if action == "create" {
    guard let p12 = input["pkcs12"] else { fail(errSecParam) }
    var trustedApplication: SecTrustedApplication?
    check(SecTrustedApplicationCreateFromPath("/usr/bin/codesign", &trustedApplication))
    var access: SecAccess?
    check(SecAccessCreate("Listen2 local build signing" as CFString,
                         [trustedApplication!] as CFArray, &access))
    var imported: CFArray?
    let options: [String: Any] = [
        kSecImportExportPassphrase as String: password,
        kSecImportExportKeychain as String: keychain,
        kSecImportExportAccess as String: access!
    ]
    check(SecPKCS12Import(try Data(contentsOf: URL(fileURLWithPath: p12)) as CFData,
                         options as CFDictionary, &imported))
}
`;

function run(command, args, { input, timeout = 30000 } = {}) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    // Never include stdin, argv, or raw helper/tool output in error messages.
    const error = new Error(
      `Local signing operation failed: ${path.basename(command)} (${
        result.error ? result.error.code : result.status
      })`
    );
    error.code = "local-signing-operation-failed";
    throw error;
  }
  return result.stdout;
}

function assertPrivateFile(filename) {
  const stat = fs.lstatSync(filename);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid()
  ) {
    throw new Error("Local signing configuration must be an owner-only file");
  }
}

function loadLocalIdentity(directory = SIGNING_DIRECTORY) {
  const filename = path.join(directory, "identity.json");
  if (!fs.existsSync(filename)) {
    if (fs.existsSync(path.join(directory, "setup-state.json"))) {
      throw new Error(
        "Local signing setup is incomplete; rerun setupMacSigning.js"
      );
    }
    return null;
  }
  const directoryStat = fs.lstatSync(directory);
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    (directoryStat.mode & 0o077) !== 0 ||
    directoryStat.uid !== process.getuid()
  ) {
    throw new Error("Local signing directory must be owner-only");
  }
  assertPrivateFile(filename);
  const identity = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (identity.version !== 1 || !/^[A-F0-9]{40}$/.test(identity.identity)) {
    throw new Error("Invalid local signing identity configuration");
  }
  return {
    identity: identity.identity,
    keychain: path.join(directory, "build.keychain-db"),
    directory,
  };
}

function unlockLocalIdentity(identity) {
  const passwordFile = path.join(identity.directory, "keychain-password");
  const helper = path.join(identity.directory, "keychain-helper");
  assertPrivateFile(identity.keychain);
  assertPrivateFile(passwordFile);
  assertPrivateFile(helper);
  run(helper, [], {
    input: JSON.stringify({
      action: "unlock",
      keychain: identity.keychain,
      password: fs.readFileSync(passwordFile, "utf8"),
    }),
  });
  const identities = run("/usr/bin/security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    identity.keychain,
  ]);
  if (!identities.includes(identity.identity)) {
    throw new Error(
      "Configured local signing identity is unavailable or untrusted"
    );
  }
}

function writePrivate(filename, data) {
  fs.writeFileSync(filename, data, { mode: 0o600, flag: "wx" });
}

function readSearchList(runCommand) {
  const output = runCommand("/usr/bin/security", [
    "list-keychains",
    "-d",
    "user",
  ]);
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const match = line.match(/^\s*"([^"\r\n]*)"\s*$/);
      if (!match)
        throw new Error("Cannot safely read user keychain search list");
      return match[1];
    });
}

function enterKeychainSearchList(keychain, runCommand) {
  const original = readSearchList(runCommand);
  if (original.includes(keychain)) return () => {};
  const restore = () => {
    runCommand("/usr/bin/security", [
      "list-keychains",
      "-d",
      "user",
      "-s",
      ...original,
    ]);
    if (
      JSON.stringify(readSearchList(runCommand)) !== JSON.stringify(original)
    ) {
      throw new Error("User keychain search list restoration failed");
    }
  };
  try {
    // codesign needs the dedicated keychain in the search list even when its
    // --keychain option is present. Never leave this change after signing.
    runCommand("/usr/bin/security", [
      "list-keychains",
      "-d",
      "user",
      "-s",
      ...original,
      keychain,
    ]);
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}

function withKeychainSearchList(keychain, operation, runCommand = run) {
  const restore = enterKeychainSearchList(keychain, runCommand);
  try {
    return operation();
  } finally {
    restore();
  }
}

let signingQueue = Promise.resolve();
function withKeychainSearchListAsync(keychain, operation, runCommand = run) {
  // Concurrent electron-builder sign hooks must not restore another hook's
  // active search list. A failed sign must also allow the next hook to run.
  const result = signingQueue.then(async () => {
    const restore = enterKeychainSearchList(keychain, runCommand);
    try {
      return await operation();
    } finally {
      restore();
    }
  });
  signingQueue = result.catch(() => {});
  return result;
}

function verifyStableIdentity(identity) {
  return withKeychainSearchList(identity.keychain, () =>
    verifyStableIdentityInSearchList(identity)
  );
}

function verifyStableIdentityInSearchList(identity) {
  const testDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "listen2-fixed-dr-")
  );
  fs.chmodSync(testDirectory, 0o700);
  try {
    const requirements = [];
    for (const version of [1, 2]) {
      const app = path.join(testDirectory, `version-${version}.app`);
      const contents = path.join(app, "Contents");
      fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
      fs.mkdirSync(path.join(contents, "Resources"));
      fs.writeFileSync(
        path.join(contents, "Info.plist"),
        `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.listen2.fixed-signing-test</string><key>CFBundleExecutable</key><string>Test</string><key>CFBundleVersion</key><string>${version}</string></dict></plist>`
      );
      fs.writeFileSync(
        path.join(contents, "Resources", "version"),
        `${version}`
      );
      const source = path.join(testDirectory, `version-${version}.c`);
      fs.writeFileSync(source, `int main(void) { return ${version - 1}; }\n`);
      run("/usr/bin/clang", [
        source,
        "-o",
        path.join(contents, "MacOS", "Test"),
      ]);
      run("/usr/bin/codesign", [
        "--force",
        "--sign",
        identity.identity,
        "--keychain",
        identity.keychain,
        "--timestamp=none",
        app,
      ]);
      run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
      // macOS versions differ in which stream receives the requirement.
      const displayed = spawnSync("/usr/bin/codesign", ["-d", "-r-", app], {
        encoding: "utf8",
        timeout: 10000,
      });
      const requirement = `${displayed.stdout}\n${displayed.stderr}`.match(
        /designated => (.+)/
      );
      if (
        displayed.status !== 0 ||
        !requirement ||
        /cdhash /.test(requirement[1])
      ) {
        throw new Error(
          "A certificate-backed designated requirement is required"
        );
      }
      requirements.push(requirement[1]);
    }
    if (requirements[0] !== requirements[1]) {
      throw new Error(
        "Local signing identity did not remain stable across builds"
      );
    }
    return { stable: true, requirement: requirements[0] };
  } finally {
    fs.rmSync(testDirectory, { recursive: true, force: true });
  }
}

function setup({ trustCodeSigning = false } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("Local macOS signing setup requires macOS");
  }
  const existing = fs.existsSync(path.join(SIGNING_DIRECTORY, "identity.json"))
    ? loadLocalIdentity()
    : null;
  if (existing) {
    unlockLocalIdentity(existing);
    const verification = verifyStableIdentity(existing);
    return { reused: true, ...verification };
  }
  process.umask(0o077);
  fs.mkdirSync(SIGNING_DIRECTORY, { recursive: true, mode: 0o700 });
  const stateFile = path.join(SIGNING_DIRECTORY, "setup-state.json");
  const certificate = path.join(SIGNING_DIRECTORY, "certificate.pem");
  const keychain = path.join(SIGNING_DIRECTORY, "build.keychain-db");
  // A partial setup is resumed explicitly below; never overwrite an identity.
  if (!fs.existsSync(stateFile)) {
    if (fs.readdirSync(SIGNING_DIRECTORY).length !== 0) {
      throw new Error(
        "Signing directory is nonempty; refusing to replace existing material"
      );
    }
    writePrivate(
      stateFile,
      JSON.stringify({ version: 1, status: "preparing" })
    );
    const passwordFile = path.join(SIGNING_DIRECTORY, "keychain-password");
    const privateKey = path.join(SIGNING_DIRECTORY, "private-key.pem");
    const pkcs12 = path.join(SIGNING_DIRECTORY, "identity.p12");
    writePrivate(passwordFile, crypto.randomBytes(32).toString("hex"));
    const config = path.join(SIGNING_DIRECTORY, "openssl.cnf");
    writePrivate(
      config,
      "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=Listen2 Local Persistent Code Signing\nO=Listen2 Local Build\n[ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n"
    );
    run("openssl", [
      "req",
      "-new",
      "-newkey",
      "rsa:3072",
      "-nodes",
      "-x509",
      "-days",
      "3650",
      "-config",
      config,
      "-keyout",
      privateKey,
      "-out",
      certificate,
    ]);
    fs.chmodSync(privateKey, 0o600);
    fs.chmodSync(certificate, 0o600);
    run("openssl", [
      "pkcs12",
      "-export",
      "-legacy",
      "-inkey",
      privateKey,
      "-in",
      certificate,
      "-out",
      pkcs12,
      "-passout",
      `file:${passwordFile}`,
    ]);
    fs.chmodSync(pkcs12, 0o600);
    const helperSource = path.join(SIGNING_DIRECTORY, "keychain-helper.swift");
    writePrivate(helperSource, KEYCHAIN_HELPER);
    const helper = path.join(SIGNING_DIRECTORY, "keychain-helper");
    run("/usr/bin/xcrun", ["swiftc", helperSource, "-o", helper], {
      timeout: 60000,
    });
    fs.chmodSync(helper, 0o700);
    run(helper, [], {
      input: JSON.stringify({
        action: "create",
        keychain,
        password: fs.readFileSync(passwordFile, "utf8"),
        pkcs12,
      }),
    });
    fs.chmodSync(keychain, 0o600);
    fs.unlinkSync(privateKey);
    fs.unlinkSync(pkcs12);
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ version: 1, status: "imported" })
    );
  }
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (state.status !== "imported") {
    throw new Error(
      "Signing setup stopped before keychain import; preserve material for recovery"
    );
  }
  if (!trustCodeSigning) {
    throw new Error(
      "Setup requires explicit --trust-code-signing for current-user codeSign trust"
    );
  }
  // No -d, sudo, System/login keychain, SSL, all-policy, or trust-error override.
  run(
    "/usr/bin/security",
    [
      "add-trusted-cert",
      "-r",
      "trustRoot",
      "-p",
      "codeSign",
      "-k",
      keychain,
      certificate,
    ],
    { timeout: 120000 }
  );
  const fingerprint = run("openssl", [
    "x509",
    "-in",
    certificate,
    "-noout",
    "-fingerprint",
    "-sha1",
  ])
    .split("=")[1]
    .trim()
    .replace(/:/g, "");
  const identity = {
    identity: fingerprint,
    keychain,
    directory: SIGNING_DIRECTORY,
  };
  unlockLocalIdentity(identity);
  const verification = verifyStableIdentity(identity);
  writePrivate(
    path.join(SIGNING_DIRECTORY, "identity.json"),
    JSON.stringify({ version: 1, identity: fingerprint }, null, 2)
  );
  return { reused: false, ...verification };
}

module.exports = {
  SIGNING_DIRECTORY,
  loadLocalIdentity,
  unlockLocalIdentity,
  verifyStableIdentity,
  withKeychainSearchList,
  withKeychainSearchListAsync,
  setup,
};
if (require.main === module) {
  try {
    console.log(
      JSON.stringify(
        setup({
          trustCodeSigning: process.argv.includes("--trust-code-signing"),
        })
      )
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
