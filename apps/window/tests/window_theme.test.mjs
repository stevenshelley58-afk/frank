import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchingNavigation } from "../web/js/window-shell.js";
import { windowTokens } from "../scripts/sync-window-theme.mjs";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
test("Window uses the approved React shadcn theme without token drift", () => {
  assert.equal(
    read("../web/tokens.css"),
    windowTokens(read("../ui/src/index.css")),
  );
  assert.match(read("../web/tokens.css"), /Geist Variable/);
});
test("navigation search matches labels, limits results and never reads conversations", () => {
  const entries = [
    { label: "Blockwise", id: "1" },
    { label: "Files", id: "2" },
  ];
  assert.deepEqual(matchingNavigation(entries, " BLOCK "), [entries[0]]);
  assert.equal(matchingNavigation(entries, "missing").length, 0);
  assert.equal(
    matchingNavigation(
      Array.from({ length: 40 }, () => entries[0]),
      "",
    ).length,
    30,
  );
  assert.deepEqual(
    entries.map((x) => x.id),
    ["1", "2"],
  );
  assert.doesNotMatch(
    read("../web/js/window-shell.js"),
    /fetch\(|requestPermission|sendBeacon|localStorage|sessionStorage/,
  );
});
test("mobile drawer retains the original rail and native modal focus handling", () => {
  const html = read("../web/index.html");
  const js = read("../web/js/window-shell.js");
  assert.match(html, /<dialog\s+id="shell-navigation"/);
  assert.match(html, /<dialog\s+id="shell-command"/);
  assert.match(html, /aria-label="Open navigation"/);
  assert.match(js, /app\.prepend\(rail\)/);
  assert.match(js, /menu\.showModal\(\)/);
  assert.match(js, /entry\.button\.click\(\)/);
});
test("background chat refresh does not overwrite another page's context", () => {
  assert.match(
    read("../web/js/app.js"),
    /if \(\$\("\.view\[data-view=hub\]"\)\.classList\.contains\("is-on"\)\) \$\("#view-sub"\)/,
  );
});
