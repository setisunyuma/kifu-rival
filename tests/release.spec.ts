import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyChanges, compareManifest, isMaintenanceScript, listReleaseFiles, sameDependencies, servingScriptsUnchanged, sha256 } from "../scripts/release.mjs";

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

test("release plan: package.json is non-served only when dependencies AND serving scripts are unchanged", () => {
  const before = { name: "x", scripts: { build: "vite build", lint: "eslint ." }, dependencies: { react: "19" }, engines: { node: ">=22" } };
  assert.equal(sameDependencies(before, { ...before, scripts: { ...before.scripts, "release:plan": "node r" } }), true);
  assert.equal(sameDependencies(before, { ...before, dependencies: { react: "20" } }), false);
  assert.equal(sameDependencies(before, { ...before, engines: { node: ">=24" } }), false);
  const ok = { packageDependenciesUnchanged: true, packageScriptsServingUnchanged: true };
  assert.equal(classifyChanges([m("package.json")], ok).level, "none");
  assert.equal(classifyChanges([m("package.json")], { ...ok, packageScriptsServingUnchanged: false }).level, "runtime");
  assert.equal(classifyChanges([m("package.json")], { packageDependenciesUnchanged: false, packageScriptsServingUnchanged: true }).level, "runtime");
  assert.equal(classifyChanges([m("package.json")]).level, "runtime", "no signals: fail safe");
  assert.equal(classifyChanges([m("package-lock.json")], ok).level, "runtime", "lockfile always needs review");
});

test("release plan: maintenance scripts are distinguished from build/start/install and lifecycle scripts", () => {
  for (const name of ["lint", "test:unit", "ledger:check", "public:check", "release:plan", "release:verify"]) assert.ok(isMaintenanceScript(name), name);
  for (const name of ["build", "dev", "start", "install:ci", "db:generate", "preinstall", "postinstall", "prepare", "prebuild", "postbuild", "deploy", "new-script"]) assert.ok(!isMaintenanceScript(name), name);
  const before = { scripts: { build: "vite build", lint: "eslint ." } };
  assert.equal(servingScriptsUnchanged(before, { scripts: { ...before.scripts, "release:plan": "x", "test:e2e": "y" } }), true, "adding maintenance scripts");
  assert.equal(servingScriptsUnchanged(before, { scripts: { ...before.scripts, lint: "eslint . --fix" } }), true, "editing lint");
  assert.equal(servingScriptsUnchanged(before, { scripts: { ...before.scripts, build: "vite build --mode x" } }), false, "editing build");
  assert.equal(servingScriptsUnchanged(before, { scripts: { ...before.scripts, postinstall: "node evil.js" } }), false, "adding a lifecycle hook");
  assert.equal(servingScriptsUnchanged(before, { scripts: { lint: "eslint ." } }), false, "removing build");
});

test("release plan: unclassified files are reviewed (runtime), known tooling is not", () => {
  for (const path of ["wrangler.toml", "new-config.json", "src/server.ts", "examples/d1/app/api/notes/route.ts", "scripts/install-ci.sh", "scripts/build-verified.sh", "scripts/new-deploy.mjs"]) {
    assert.equal(classifyChanges([m(path, "A")]).level, "runtime", path);
  }
  for (const path of ["README.md", "AGENTS.md", "docs/RELEASE.md", "tests/x.spec.ts", ".github/workflows/verify.yml", "scripts/check-ledger.mjs", "scripts/release.mjs", "eslint.config.mjs"]) {
    assert.equal(classifyChanges([m(path)]).level, "none", path);
  }
  assert.equal(classifyChanges([m("drizzle.config.ts")]).level, "data");
});
