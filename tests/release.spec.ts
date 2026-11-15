import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyChanges, compareManifest, crossCheckDryRun, evaluateGates, isMaintenanceScript, planSync, rsyncExcludes, scanTree, storageChange, listReleaseFiles, sameDependencies, servingScriptsUnchanged, sha256 } from "../scripts/release.mjs";

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

// ---------------------------------------------------------------------------
// Gates (review of PR #9, round 3): passing must not imply unverified conditions.
// ---------------------------------------------------------------------------
const okPlan = planSync(github, { ...github });
const okDry = crossCheckDryRun(okPlan, "");
const allOk = { plan: okPlan, dryRun: okDry, snapshotMatchesSite: true, archiveMatchesSnapshot: true, dataApproval: null,
  releasePlan: { head: "abc", level: "none" }, manifestCommit: "abc", githubMatchesManifest: true, contentData: [], unhandled: [] };

test("gates: everything verified passes, and the manual gate is reported as not required", () => {
  const g = evaluateGates(allOk);
  assert.equal(g.passed, true);
  assert.equal(g.level, "none");
  assert.equal(g.manual[0].required, false);
});

test("gates: decided differences alone are not enough without a verified backup and dry-run", () => {
  assert.equal(evaluateGates({ ...allOk, snapshotMatchesSite: null }).passed, false, "no snapshot");
  assert.equal(evaluateGates({ ...allOk, snapshotMatchesSite: false }).passed, false, "snapshot of another state");
  assert.equal(evaluateGates({ ...allOk, archiveMatchesSnapshot: null }).passed, false, "no archive");
  assert.equal(evaluateGates({ ...allOk, archiveMatchesSnapshot: false }).passed, false, "archive does not restore");
  assert.equal(evaluateGates({ ...allOk, dryRun: null }).passed, false, "dry-run is mandatory");
});

test("gates: a sync touching data-level paths requires a complete approval record (presence only)", () => {
  const site = { ...github };
  const plan = planSync({ ...github, "drizzle/0001_add.sql": H("sql") }, site);
  assert.equal(evaluateGates({ ...allOk, plan, dryRun: crossCheckDryRun(plan, ">f+++++++++ drizzle/0001_add.sql\n") }).level, "data");
  const base = { ...allOk, plan, dryRun: crossCheckDryRun(plan, ">f+++++++++ drizzle/0001_add.sql\n") };
  assert.equal(evaluateGates(base).passed, false, "no approval");
  assert.equal(evaluateGates({ ...base, dataApproval: { approvedBy: "user", approvedOn: "2026-11-15", scope: "add table", d1Backup: "", deviceDataBackup: "x", rollbackPlan: "x" } }).passed, false, "incomplete record");
  assert.equal(evaluateGates({ ...base, dataApproval: { approvedBy: "user", approvedOn: "2026-11-15", scope: "add table", d1Backup: "export taken", rollbackPlan: "restore export" } }).passed, false, "device data backup is required too");
  const full = evaluateGates({ ...base, dataApproval: { approvedBy: "user", approvedOn: "2026-11-15", scope: "add table", d1Backup: "export taken", deviceDataBackup: "exported JSON", rollbackPlan: "restore export" } });
  assert.equal(full.passed, true);
  assert.match(full.manual[0].gate, /not verified/);
});

// ---------------------------------------------------------------------------
// Review of PR #9, round 4: data changes must not bypass the approval gate by content,
// and nothing may be deleted or overwritten without being verified.
// ---------------------------------------------------------------------------
const approval = { approvedBy: "user", approvedOn: "2026-11-15", scope: "rename key", d1Backup: "n/a (device data)", deviceDataBackup: "exported JSON on the device", rollbackPlan: "migrate back" };

test("content check: storage key changes and new destructive storage calls are data changes", () => {
  assert.equal(storageChange('const STORAGE_KEY = "kifu-rival.v1";', 'const STORAGE_KEY = "kifu-rival.v2";').changed, true);
  assert.equal(storageChange('localStorage.getItem("a")', 'localStorage.getItem("b")').changed, true);
  assert.equal(storageChange('localStorage.getItem("a")', 'localStorage.getItem("a"); localStorage.removeItem("a")').changed, true);
  assert.equal(storageChange("x", "x; indexedDB.deleteDatabase('db')").changed, true);
  assert.equal(storageChange('const a = 1; localStorage.getItem("a")', 'const a = 2; localStorage.getItem("a")').changed, false);
  assert.equal(storageChange(null, 'const STORAGE_KEY = "kifu-rival.v1";').changed, true, "a new file that introduces a key");
  const plan = classifyChanges([{ status: "M", path: "lib/progress.ts" }], { contentData: [{ path: "lib/progress.ts", reasons: ["storage keys changed"] }] });
  assert.equal(plan.level, "data", "release:plan uses the same content check for any served file");
});

test("gates: a storage-key change in ordinary app code needs the data approval (content, not path)", () => {
  const site = { ...github }; const gh = { ...github, "app/rival-app.tsx": H("v2") };
  const plan = planSync(gh, { ...site, "app/rival-app.tsx": H("v1") }, [{ path: "app/rival-app.tsx", action: "overwrite", siteSha256: H("v1"), reason: "r", decidedBy: "u" }]);
  const base = { ...allOk, plan, dryRun: crossCheckDryRun(plan, ">f.st...... app/rival-app.tsx\n"), contentData: [{ path: "app/rival-app.tsx", reasons: ["storage keys changed"] }] };
  const g = evaluateGates(base);
  assert.equal(g.level, "data", "path alone says app; content says data");
  assert.equal(g.passed, false, "no approval -> stop");
  assert.match(g.manual[0].detail, /app\/rival-app\.tsx: storage keys changed/);
  assert.equal(evaluateGates({ ...base, dataApproval: approval }).passed, true);
});

test("gates: the release plan must belong to this commit, and its data level cannot be bypassed", () => {
  assert.equal(evaluateGates({ ...allOk, releasePlan: null }).passed, false, "plan is mandatory");
  assert.equal(evaluateGates({ ...allOk, releasePlan: { head: "other", level: "none" } }).passed, false, "plan for another commit");
  const fromPlan = evaluateGates({ ...allOk, releasePlan: { head: "abc", level: "data" } });
  assert.equal(fromPlan.level, "data");
  assert.equal(fromPlan.passed, false, "plan says data although this sync looks harmless");
  assert.equal(evaluateGates({ ...allOk, releasePlan: { head: "abc", level: "data" }, dataApproval: approval }).passed, true);
  assert.equal(evaluateGates({ ...allOk, githubMatchesManifest: false }).passed, false, "GitHub checkout differs from the manifest");
});

test("scan: ignored, symlinked and special paths are reported, never silently dropped", () => {
  const root = mkdtempSync(join(tmpdir(), "kifu-scan-"));
  try {
    mkdirSync(join(root, "lib")); mkdirSync(join(root, ".wrangler", "state"), { recursive: true }); mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "lib", "a.ts"), "a"); writeFileSync(join(root, ".dev.vars"), "SECRET=x"); writeFileSync(join(root, ".wrangler", "state", "d1.sqlite"), "db");
    symlinkSync(join(root, "lib", "a.ts"), join(root, "lib", "link.ts"));
    const scan = scanTree(root);
    assert.deepEqual(scan.files, ["lib/a.ts"]);
    assert.deepEqual(scan.skipped.map(x => `${x.reason}:${x.path}`).sort(), ["ignored-dir:.wrangler/", "ignored-dir:node_modules/", "ignored-file:.dev.vars", "symlink:lib/link.ts"]);
    const unhandled = scan.skipped.filter(x => x.reason === "symlink" || x.reason === "special");
    assert.equal(evaluateGates({ ...allOk, unhandled }).passed, false, "a symlink stops the release");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rsync excludes cover every ignored path, so local data such as .wrangler state or .dev.vars is never deleted", () => {
  const ex = rsyncExcludes();
  for (const d of [".git/", "node_modules/", ".wrangler/", ".sites-runtime/", "dist/", "outputs/"]) assert.ok(ex.includes(d), d);
  for (const f of [".env*", ".dev.vars*", "*.pem"]) assert.ok(ex.includes(f), f);
  // A dry-run that deletes an ignored file means the excludes were not applied: stop.
  const plan = planSync(github, { ...github });
  assert.deepEqual(crossCheckDryRun(plan, "*deleting   .dev.vars\n").unexpectedDeletions, [".dev.vars"]);
});

// ---------------------------------------------------------------------------
// Review of PR #9, round 5: whitespace/newlines and same-count destructive swaps.
// ---------------------------------------------------------------------------
const KEY = 'const STORAGE_KEY = "kifu-rival.v1";\n';
const BEFORE_RM = KEY + "export function reset() { window.localStorage.removeItem(STORAGE_KEY); }\n";
const AFTER_CLEAR = KEY + "export function reset() { window.localStorage.clear(); }\n";

test("storage check: clear with spaces or a line break before the parenthesis is a data change", () => {
  assert.equal(storageChange(KEY, KEY + "window.localStorage.clear ();").changed, true);
  assert.equal(storageChange(KEY, KEY + "window.localStorage\n  .clear\n  ();").changed, true);
  assert.equal(storageChange(KEY, KEY + "indexedDB . deleteDatabase ( 'x' );").changed, true);
});

test("storage check: removeItem(STORAGE_KEY) -> clear() with the same count is a data change", () => {
  const r = storageChange(BEFORE_RM, AFTER_CLEAR);
  assert.equal(r.changed, true);
  assert.match(r.reasons.join(" "), /localStorage \. clear \( \)/);
});

test("storage check: UI-only changes and whitespace-only edits of storage code are not data", () => {
  const ui = (label: string) => KEY + `export const Title = () => "${label}";\nwindow.localStorage.getItem(STORAGE_KEY);\n`;
  assert.equal(storageChange(ui("棋友"), ui("棋友 KIYU")).changed, false);
  assert.equal(storageChange("window.localStorage.getItem(STORAGE_KEY);", "window.localStorage.getItem( STORAGE_KEY );").changed, false);
});

test("storage check: comments that mention storage are not code", () => {
  assert.equal(storageChange("const a = 1;", "/* kept in localStorage, never sent */ const a = 1;\n// localStorage.clear() is not called here").changed, false);
  assert.equal(storageChange("const u = 'https://x';", "const u = 'https://x'; localStorage.clear();").changed, true, "URLs do not hide code after them");
});

test("storage check: string contents are kept (spaces and // inside strings)", () => {
  assert.equal(storageChange('localStorage.getItem("lesson history");', 'localStorage.getItem("lessonhistory");').changed, true, "different keys stay different");
  const before = 'const assetRoot = "//cdn.example";\n';
  const r = storageChange(before, 'const assetRoot = "//cdn.example"; window.localStorage.clear();\n');
  assert.equal(r.changed, true, "// inside a string is not a comment");
  assert.match(r.reasons.join(" "), /clear/);
  assert.equal(storageChange('const s = "a ; b"; localStorage.getItem(K);', 'const s = "a ; b";\nlocalStorage.getItem( K );').changed, false, "formatting only");
});

test("storage check: a storage statement whose effect cannot be judged is still data", () => {
  assert.equal(storageChange("localStorage.setItem(KEY, JSON.stringify(a));", "localStorage.setItem(KEY, JSON.stringify(b));").changed, true);
});

const RELEASE = resolve("scripts/release.mjs");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [RELEASE, ...args], { cwd, encoding: "utf8" });

const STRING_CASES: [string, string, string][] = [
  ["spaces inside a key", 'export const load = () => window.localStorage.getItem("lesson history");\n', 'export const load = () => window.localStorage.getItem("lessonhistory");\n'],
  ["// inside a string", 'export const assetRoot = "//cdn.example";\n', 'export const assetRoot = "//cdn.example";\nwindow.localStorage.clear();\n'],
  ["// inside a string, same line", 'export const assetRoot = "//cdn.example";\n', 'export const assetRoot = "//cdn.example"; window.localStorage.clear();\n'],
];

test("release:plan (real git diff): string-content cases are data", () => {
  for (const [name, before, after] of STRING_CASES) {
    const repo = mkdtempSync(join(tmpdir(), "kifu-plan-s-"));
    try {
      git(repo, "init", "-q"); git(repo, "config", "user.email", "t@example.com"); git(repo, "config", "user.name", "t");
      mkdirSync(join(repo, "lib"));
      writeFileSync(join(repo, "lib", "store.ts"), before); git(repo, "add", "."); git(repo, "commit", "-qm", "a");
      const base = git(repo, "rev-parse", "HEAD");
      writeFileSync(join(repo, "lib", "store.ts"), after); git(repo, "commit", "-qam", "b");
      const r = run(repo, "plan", "--base", base);
      assert.equal(r.status, 2, `${name}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /level=data/, name);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("release:plan (real git diff) classifies removeItem -> clear as data and writes the plan", () => {
  const repo = mkdtempSync(join(tmpdir(), "kifu-plan-"));
  try {
    git(repo, "init", "-q"); git(repo, "config", "user.email", "t@example.com"); git(repo, "config", "user.name", "t");
    mkdirSync(join(repo, "app"));
    writeFileSync(join(repo, "app", "store.ts"), BEFORE_RM); git(repo, "add", "."); git(repo, "commit", "-qm", "a");
    const base = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "app", "store.ts"), AFTER_CLEAR); git(repo, "commit", "-qam", "b");
    const r = run(repo, "plan", "--base", base, "--out", join(repo, "plan.json"));
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(JSON.parse(readFileSync(join(repo, "plan.json"), "utf8")).level, "data");
    writeFileSync(join(repo, "app", "store.ts"), AFTER_CLEAR + 'export const label = "x";\n'); git(repo, "commit", "-qam", "c");
    const head = git(repo, "rev-parse", "HEAD");
    const ui = run(repo, "plan", "--base", git(repo, "rev-parse", "HEAD~1"), "--head", head);
    assert.equal(ui.status, 0, "a UI-only change after that is app, not data");
    assert.match(ui.stdout, /level=app/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

function preflightCase(siteText: string, ghText: string) {
  const dir = mkdtempSync(join(tmpdir(), "kifu-pre-"));
  try {
    const gh = join(dir, "gh"), site = join(dir, "site");
    for (const d of [gh, site]) mkdirSync(join(d, "app"), { recursive: true });
    writeFileSync(join(gh, "app", "store.ts"), ghText); writeFileSync(join(site, "app", "store.ts"), siteText);
    writeFileSync(join(dir, "release.json"), JSON.stringify({ schema: 1, repository: "t", commit: "c1", files: { "app/store.ts": sha256(ghText) } }));
    writeFileSync(join(dir, "plan.json"), JSON.stringify({ head: "c1", level: "app" }));
    writeFileSync(join(dir, "dec.json"), JSON.stringify([{ path: "app/store.ts", action: "overwrite", siteSha256: sha256(siteText), reason: "r", decidedBy: "u" }]));
    writeFileSync(join(dir, "dry.txt"), ">f.st...... app/store.ts\n");
    execFileSync("tar", ["-czf", join(dir, "backup.tgz"), "-C", site, "."]);
    assert.equal(run(dir, "snapshot", "--root", site, "--out", join(dir, "snap.json")).status, 0);
    const args = ["preflight", join(dir, "release.json"), "--root", site, "--github-root", gh, "--release-plan", join(dir, "plan.json"),
      "--decisions", join(dir, "dec.json"), "--rsync-dry-run", join(dir, "dry.txt"), "--backup-snapshot", join(dir, "snap.json"), "--backup-archive", join(dir, "backup.tgz")];
    writeFileSync(join(dir, "appr.json"), JSON.stringify(approval));
    return { stop: run(dir, ...args), pass: run(dir, ...args, "--data-approval", join(dir, "appr.json")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("preflight (real files): storage changes stop without approval even when every other gate passes", () => {
  for (const [name, site, gh] of [["removeItem -> clear", BEFORE_RM, AFTER_CLEAR], ...STRING_CASES] as [string, string, string][]) {
    const { stop, pass } = preflightCase(site, gh);
    assert.equal(stop.status, 3, `${name}: ${stop.stdout}`);
    assert.match(stop.stdout, /level of this release: data/, name);
    assert.match(stop.stdout, /\[NG\] data change approval/, name);
    assert.doesNotMatch(stop.stdout, /\[NG\] (release plan|GitHub checkout|no symlinks|file differences|rsync|backup)/, `${name}: only the approval gate is missing`);
    assert.equal(pass.status, 0, `${name}: ${pass.stdout}`);
    assert.match(pass.stdout, /GATES PASSED/, name);
  }
});

test("preflight (real files): a UI-only change is not data and passes without approval", () => {
  const ui = (label: string) => KEY + `export const Title = () => "${label}";\nwindow.localStorage.getItem(STORAGE_KEY);\n`;
  const { stop } = preflightCase(ui("棋友"), ui("棋友 KIYU"));
  assert.equal(stop.status, 0, stop.stdout);
  assert.match(stop.stdout, /level of this release: app/);
});
