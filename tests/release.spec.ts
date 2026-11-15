import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyChanges, compareManifest, crossCheckDryRun, isMaintenanceScript, planSync, listReleaseFiles, sameDependencies, servingScriptsUnchanged, sha256 } from "../scripts/release.mjs";

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

// ---------------------------------------------------------------------------
// Pre-sync safety (review of PR #9): detect Site-only content BEFORE any sync.
// ---------------------------------------------------------------------------
const H = (x: string) => sha256(x);
const github = { "lib/shogi.ts": H("new"), "README.md": H("readme") };
const decision = (path: string, action: "overwrite" | "delete", content: string) => ({ path, action, siteSha256: H(content), reason: "reviewed: GitHub has the newer version", decidedBy: "user" });

test("preflight: identical trees are safe and plan no changes", () => {
  const plan = planSync(github, { ...github });
  assert.deepEqual([plan.add, plan.overwrite, plan.delete, plan.unresolved], [[], [], [], []]);
  assert.equal(plan.safe, true);
});

test("preflight: a file that exists only on the Site stops the sync", () => {
  const plan = planSync(github, { ...github, "lib/site-only-lessons.ts": H("site work") });
  assert.deepEqual(plan.delete, ["lib/site-only-lessons.ts"]);
  assert.equal(plan.safe, false);
  assert.deepEqual(plan.unresolved.map(u => [u.action, u.path]), [["delete", "lib/site-only-lessons.ts"]]);
});

test("preflight: a file whose content differs stops the sync until a person decides", () => {
  const site = { ...github, "lib/shogi.ts": H("site edit") };
  assert.equal(planSync(github, site).safe, false);
  assert.equal(planSync(github, site, [decision("lib/shogi.ts", "overwrite", "site edit")]).safe, true);
  assert.equal(planSync(github, site, [{ ...decision("lib/shogi.ts", "overwrite", "site edit"), reason: " " }]).safe, false, "a decision needs a reason");
  assert.equal(planSync(github, site, [decision("lib/shogi.ts", "delete", "site edit")]).safe, false, "the decided action must match");
});

test("preflight: a file deleted on GitHub but still on the Site is listed for deletion and needs a decision", () => {
  const site = { ...github, "app/old-feature.tsx": H("old") };
  const plan = planSync(github, site, [decision("app/old-feature.tsx", "delete", "old")]);
  assert.deepEqual(plan.delete, ["app/old-feature.tsx"]);
  assert.equal(plan.safe, true);
});

test("preflight: a decision becomes stale when the Site file changes after review (sync stops again)", () => {
  const reviewed = [decision("lib/shogi.ts", "overwrite", "site edit v1")];
  const plan = planSync(github, { ...github, "lib/shogi.ts": H("site edit v2") }, reviewed);
  assert.equal(plan.safe, false);
  assert.deepEqual(plan.stale, ["lib/shogi.ts"]);
});

test("preflight: files only added from GitHub need no decision (nothing on the Site is lost)", () => {
  const plan = planSync(github, { "README.md": H("readme") });
  assert.deepEqual(plan.add, ["lib/shogi.ts"]);
  assert.equal(plan.safe, true);
});

test("preflight: an rsync dry-run that disagrees with the plan is detected", () => {
  const site = { ...github, "lib/shogi.ts": H("old"), "app/old.tsx": H("x") };
  const plan = planSync(github, site, [decision("lib/shogi.ts", "overwrite", "old"), decision("app/old.tsx", "delete", "x")]);
  const agree = ">f.st...... lib/shogi.ts\n*deleting   app/old.tsx\ncd+++++++++ lib/\n";
  assert.equal(crossCheckDryRun(plan, agree).ok, true);
  const extraDelete = agree + "*deleting   db/local-backup.sql\n";
  assert.deepEqual(crossCheckDryRun(plan, extraDelete).unexpectedDeletions, ["db/local-backup.sql"], "e.g. an exclude rule was forgotten");
  assert.deepEqual(crossCheckDryRun(plan, ">f.st...... lib/shogi.ts\n").missedDeletions, ["app/old.tsx"]);
  assert.deepEqual(crossCheckDryRun(plan, agree + ">f+++++++++ public/x.png\n").unexpectedTransfers, ["public/x.png"]);
  assert.equal(crossCheckDryRun(plan, agree + ".f..tp..... docs/README.md\n").ok, true, "attribute-only updates move no data");
});

test("post-sync verify: tampering after the sync is detected by the hash check", () => {
  const root = mkdtempSync(join(tmpdir(), "kifu-sync-"));
  try {
    mkdirSync(join(root, "lib"));
    writeFileSync(join(root, "lib", "shogi.ts"), "new"); writeFileSync(join(root, "README.md"), "readme");
    const hashes = () => Object.fromEntries(listReleaseFiles(root).map(p => [p, sha256(readFileSync(join(root, p)))]));
    assert.equal(compareManifest(github, hashes()).ok, true, "synced tree matches");
    writeFileSync(join(root, "lib", "shogi.ts"), "tampered");
    assert.deepEqual(compareManifest(github, hashes()).changed, ["lib/shogi.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
