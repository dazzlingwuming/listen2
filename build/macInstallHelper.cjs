"use strict";

// No signing API is called here. The manifest describes the final packaged tree.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const NAMES = [
  "Install Listen1.command",
  "Listen1.integrity.tsv",
  "INSTALL-LISTEN1.txt",
];
const ID = "com.listen1.listen1";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function manifestFor(bundle, version) {
  if (
    path.basename(bundle) !== "Listen1.app" ||
    fs.lstatSync(bundle).isSymbolicLink()
  )
    throw new Error("Expected a real Listen1.app directory");
  const plist = path.join(bundle, "Contents/Info.plist");
  const readPlist = (key) =>
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], {
      encoding: "utf8",
    }).trim();
  if (
    readPlist("CFBundleIdentifier") !== ID ||
    readPlist("CFBundleShortVersionString") !== version ||
    readPlist("CFBundleExecutable") !== "Listen1"
  )
    throw new Error("Unexpected Listen1 bundle identity/version/executable");
  const architectures = execFileSync(
    "/usr/bin/lipo",
    ["-archs", path.join(bundle, "Contents/MacOS/Listen1")],
    { encoding: "utf8" }
  )
    .trim()
    .split(/\s+/)
    .sort()
    .join(" ");
  if (!["arm64", "x86_64", "arm64 x86_64"].includes(architectures))
    throw new Error("Unsupported bundle architecture");
  const rows = [`LISTEN1-INTEGRITY-1\t${ID}\t${version}\t${architectures}`];
  const realBundle = fs.realpathSync(bundle);
  function visit(relative) {
    if (/[\x00-\x1f\x7f]/.test(relative))
      throw new Error("Control characters in bundle path");
    const absolute = path.join(bundle, relative);
    const stat = fs.lstatSync(absolute);
    const mode = (stat.mode & 0o7777).toString(8);
    if ((stat.mode & 0o7000) !== 0)
      throw new Error("Special permission bits are unsupported");
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(absolute);
      if (!target || path.isAbsolute(target) || /[\x00-\x1f\x7f]/.test(target))
        throw new Error("Unsupported symlink");
      const resolved = fs.realpathSync(absolute);
      if (
        resolved !== realBundle &&
        !resolved.startsWith(realBundle + path.sep)
      )
        throw new Error("Symlink escapes bundle");
      rows.push(`L\t${mode}\t${target}\t${relative}`);
    } else if (stat.isDirectory()) {
      rows.push(`D\t${mode}\t-\t${relative}`);
      for (const name of fs.readdirSync(absolute).sort())
        visit(relative === "." ? name : `${relative}/${name}`);
    } else if (stat.isFile()) {
      rows.push(`F\t${mode}\t${hash(fs.readFileSync(absolute))}\t${relative}`);
    } else throw new Error("Unsupported bundle entry");
  }
  visit(".");
  return rows.join("\n") + "\n";
}

function generate(bundle, version) {
  const output = path.dirname(bundle);
  const manifest = manifestFor(bundle, version);
  fs.writeFileSync(path.join(output, NAMES[1]), manifest, { mode: 0o644 });
  const template = fs.readFileSync(
    path.join(__dirname, "mac-install/install.sh"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(output, NAMES[0]),
    template.replace("@MANIFEST_SHA256@", hash(manifest)),
    { mode: 0o755 }
  );
  fs.copyFileSync(
    path.join(__dirname, "mac-install/INSTALL-LISTEN1.txt"),
    path.join(output, NAMES[2])
  );
  return NAMES.map((name) => path.join(output, name));
}

function attachDmgFiles(target) {
  if (target.name !== "dmg" || target.__listen1InstallHelper) return;
  const originalBuild = target.build;
  target.build = function (appPath, arch) {
    // electron-builder shares targets across architecture tasks. Never change its
    // shared options; bind the sidecars to this exact appPath for this build.
    const scoped = Object.create(this);
    scoped.options = {
      ...this.options,
      contents: [
        ...(this.options.contents || [
          { x: 192, y: 220 },
          { x: 448, y: 220, type: "link", path: "/Applications" },
        ]),
        ...NAMES.map((name, i) => ({
          x: 160 + i * 190,
          y: 440,
          type: "file",
          path: path.join(path.dirname(appPath), name),
        })),
      ],
    };
    return originalBuild.call(scoped, appPath, arch);
  };
  target.__listen1InstallHelper = true;
}

async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  generate(
    path.join(context.appOutDir, "Listen1.app"),
    context.packager.appInfo.version
  );
  for (const target of context.targets) attachDmgFiles(target);
}
module.exports = afterPack;
module.exports.manifestFor = manifestFor;
module.exports.generate = generate;
module.exports.attachDmgFiles = attachDmgFiles;
