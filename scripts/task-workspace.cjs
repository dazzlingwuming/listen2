#!/usr/bin/env node
"use strict";

// Only this task's registered scratch directory is eligible for cleanup.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const id = process.env.LISTEN2_TASK_ID || "macos-daily-theme-20261025";
if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new Error("Invalid task id");
const base = path.join(root, ".task-workspaces", id);
const statePath = path.join(base, "state.json");
const action = process.argv[2];
const arg = process.argv
  .slice(3)
  .filter((value) => value !== "--accepted")
  .join(" ");
const now = new Date().toISOString();
const save = (state) =>
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) {
  throw new Error("Refusing a symlink workspace");
}
if (action === "prepare" || action === "resume") {
  fs.mkdirSync(path.join(base, "scratch"), { recursive: true });
  const previous = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, "utf8"))
    : {};
  save({
    ...previous,
    id,
    root,
    status: "active",
    updatedAt: now,
    retentionDays: 3,
  });
} else if (action === "run") {
  const label = process.argv[3];
  const divider = process.argv.indexOf("--", 4);
  const command = divider >= 0 ? process.argv.slice(divider + 1) : [];
  if (!/^[a-z0-9-]+$/.test(label || "") || !command.length)
    throw new Error("Use run <label> -- <command> [args]");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (state.running && alive(state.running.pid))
    throw new Error("Another registered command is still running");
  save({
    ...state,
    status: "active",
    running: { pid: process.pid, label, startedAt: now },
    updatedAt: now,
  });
  const result = spawnSync(command[0], command.slice(1), {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  const receipt = {
    label,
    command,
    startedAt: now,
    endedAt: new Date().toISOString(),
    exitCode: result.status,
    signal: result.signal,
    error: result.error ? result.error.code : undefined,
  };
  fs.writeFileSync(
    path.join(base, "scratch", `${label}-receipt.json`),
    JSON.stringify(receipt, null, 2) + "\n"
  );
  save({
    ...state,
    status: result.status === 0 ? "active" : "needs-recovery",
    updatedAt: receipt.endedAt,
    lastCommand: receipt,
    running: null,
  });
  process.exitCode = result.status === 0 ? 0 : 1;
} else if (action === "published") {
  const receiptPath = path.resolve(arg);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  if (
    !receipt.verified ||
    !/^https:\/\/github\.com\/dazzlingwuming\/listen2\/releases\/tag\/v[\d.]+(?:-android\.\d+)?$/.test(
      receipt.releaseUrl || ""
    )
  )
    throw new Error("A verified GitHub release receipt is required");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  save({
    ...state,
    delivery: { receiptPath, releaseUrl: receipt.releaseUrl },
    updatedAt: now,
  });
} else if (action === "retain") {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...state,
        status: "needs-recovery",
        updatedAt: now,
        reason: arg,
        expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      },
      null,
      2
    ) + "\n"
  );
} else if (action === "complete") {
  const artifact = path.resolve(arg);
  const deliveryRoot = path.join(root, "dist", "releases") + path.sep;
  if (
    !artifact.startsWith(deliveryRoot) ||
    !fs.statSync(artifact).isFile() ||
    fs.lstatSync(artifact).isSymbolicLink()
  ) {
    throw new Error("A verified independent release artifact is required");
  }
  if (!process.argv.includes("--accepted"))
    throw new Error("Use complete <artifact> --accepted after acceptance");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (state.running && alive(state.running.pid))
    throw new Error("A registered command is still running");
  if (!state.delivery)
    throw new Error(
      "Register the independently verified release receipt with published first"
    );
  const sha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(artifact))
    .digest("hex");
  const receipt = JSON.parse(
    fs.readFileSync(state.delivery.receiptPath, "utf8")
  );
  if (
    !receipt.verified ||
    !receipt.assets?.some(
      (entry) =>
        entry.name === path.basename(artifact) && entry.sha256 === sha256
    )
  )
    throw new Error("Artifact hash is absent from verified release receipt");
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      { ...state, status: "complete", updatedAt: now, artifact, sha256 },
      null,
      2
    ) + "\n"
  );
  const scratch = path.join(base, "scratch");
  if (fs.existsSync(scratch) && !fs.lstatSync(scratch).isSymbolicLink())
    fs.rmSync(scratch, { recursive: true });
} else if (action !== "status") {
  throw new Error(
    "Use prepare | resume | run <label> -- <command> | retain <reason> | published <receipt> | complete <artifact> --accepted | status"
  );
}
process.stdout.write(fs.readFileSync(statePath, "utf8"));
