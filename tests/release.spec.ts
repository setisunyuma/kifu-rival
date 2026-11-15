import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyChanges, compareManifest, listReleaseFiles, sha256 } from "../scripts/release.mjs";

const m = (path: string, status = "M") => ({ status, path });

test("release plan: docs/tests/CI only means no served change", () => {
  const r = classifyChanges([m("docs/ledger/WORK_ITEMS.md"), m("tests/shogi.spec.ts"), m(".github/workflows/verify.yml"), m("scripts/release.mjs", "A")]);
  assert.equal(r.level, "none");
});

test("release plan: game logic and UI are an ordinary app release", () => {
  assert.equal(classifyChanges([m("lib/shogi.ts"), m("app/globals.css"), m("docs/ROADMAP.md")]).level, "app");
});

test("release plan: API, Worker and dependencies need review", () => {
  for (const path of ["app/api/progress/route.ts", "worker/index.ts", "package-lock.json", "vite.config.ts"]) {
    assert.equal(classifyChanges([m(path)]).level, "runtime", path);
  }
  assert.equal(classifyChanges([m("public/favicon.svg", "D")]).level, "runtime", "deleting a served file");
});

test("release plan: migrations, schema, hosting bindings, auth and storage-key changes stop the release", () => {
  for (const path of ["drizzle/0001_new.sql", "db/schema.ts", ".openai/hosting.json", "app/chatgpt-auth.ts"]) {
    assert.equal(classifyChanges([m(path, "A"), m("lib/shogi.ts")]).level, "data", path);
  }
  const key = classifyChanges([m("app/rival-app.tsx")], { storageKeyChanged: true });
  assert.equal(key.level, "data");
  assert.match(key.decision, /STOP/);
});

test("release verify: ignored local state is skipped and every difference is reported", () => {
  const root = mkdtempSync(join(tmpdir(), "kifu-release-"));
  try {
    mkdirSync(join(root, "lib")); mkdirSync(join(root, "node_modules", "x"), { recursive: true }); mkdirSync(join(root, ".git"));
    writeFileSync(join(root, "lib", "shogi.ts"), "a");
    writeFileSync(join(root, "README.md"), "b");
    writeFileSync(join(root, "node_modules", "x", "i.js"), "ignored");
    writeFileSync(join(root, ".git", "HEAD"), "ignored");
    writeFileSync(join(root, ".env.local"), "SECRET=ignored");
    assert.deepEqual(listReleaseFiles(root), ["README.md", "lib/shogi.ts"]);

    const expected = { "README.md": sha256("b"), "lib/shogi.ts": sha256("a"), "lib/lessons.ts": sha256("c") };
    const actual = Object.fromEntries(listReleaseFiles(root).map(p => [p, p === "README.md" ? sha256("edited") : sha256("a")]));
    actual["sites-only.txt"] = sha256("x");
    const r = compareManifest(expected, actual);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["lib/lessons.ts"]);
    assert.deepEqual(r.changed, ["README.md"]);
    assert.deepEqual(r.extra, ["sites-only.txt"]);
    assert.equal(compareManifest(expected, { ...expected }).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
