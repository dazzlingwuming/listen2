const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
  path.join(__dirname, "../listen1_chrome_extension/css/redesign.css"),
  "utf8"
);

function rulesFor(selector) {
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  const found = [];
  let match = pattern.exec(css);
  while (match) {
    const selectors = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((item) => item.trim());
    if (selectors.includes(selector)) found.push(match[2]);
    match = pattern.exec(css);
  }
  return found;
}

test("the annual recap entry is explicitly no-drag inside the drag-region navigation", () => {
  for (const selector of [
    ".navigation .annual-recap-entry",
    ".navigation .annual-recap-entry *",
  ]) {
    const bodies = rulesFor(selector);
    assert.ok(bodies.length > 0, `${selector} rule is missing`);
    assert.ok(
      bodies.some((body) =>
        /-webkit-app-region:\s*no-drag\s*!important/.test(body)
      ),
      `${selector} must set -webkit-app-region: no-drag !important`
    );
  }
});

test("the annual recap entry is rendered inside the navigation in the main page", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../listen1_chrome_extension/listen1.html"),
    "utf8"
  );
  assert.match(html, /class="settings annual-recap-entry"/);
});
