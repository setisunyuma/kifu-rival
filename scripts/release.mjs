/**
 * Release helper for GitHub main -> private ChatGPT Site (KIF-003).
 *
 * This script never deploys, never talks to ChatGPT Sites, and never touches D1.
 * It produces evidence that a human/ChatGPT operator uses during the documented
 * procedure in docs/RELEASE.md:
 *
 *   node scripts/release.mjs plan --base <released-sha> [--head <sha>]
 *       Classify what changed since the last release and whether it needs approval.
 *   node scripts/release.mjs manifest [--out <file>]
 *       Hash every tracked file of a clean checkout (the GitHub release commit).
 *   node scripts/release.mjs snapshot --root <dir> --out <file>
 *       Hash every file of any directory (e.g. the Sites checkout BEFORE syncing), for
 *       backup integrity and for verifying a restore. Needs no Git.
 *   node scripts/release.mjs preflight <manifest.json> --root <dir> --backup-snapshot <file>
 *       --backup-archive <tgz> --rsync-dry-run <file> [--decisions <file>] [--data-approval <file>] [--out <file>]
 *       READ-ONLY gate check before syncing. Automated gates (all required): every overwrite/
 *       delete has a decision bound to the file's current hash; the rsync dry-run matches the
 *       plan; the backup snapshot matches the Site as it is now; the backup archive restores
 *       to exactly that snapshot. Manual gate: if the sync touches data-level paths (D1,
 *       bindings, auth), an approval record must be supplied — the tool checks it is present
 *       and complete, NOT that it is true. Exit 0 = gates passed, 3 = STOP.
 *   node scripts/release.mjs verify <manifest.json> [--root <dir>]
 *       AFTER syncing: compare a directory against the manifest (detects any difference).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const MANIFEST_SCHEMA = 1;

/**
 * Files known NOT to affect what the Site builds or runs. Anything not listed here
 * and not matched by a more specific rule is treated as `runtime` (fail safe), so a
 * new config file or code directory is reviewed rather than silently ignored.
 */
const NOT_SERVED_FILES = new Set([
  "README.md", "AGENTS.md", "CLAUDE.md", "LICENSE", ".gitignore", "eslint.config.mjs",
  "scripts/check-ledger.mjs", "scripts/check-public-release.mjs", "scripts/guarded-auto-merge.mjs",
  "scripts/release.mjs", "scripts/test-unit.mjs",
]);
const NOT_SERVED_DIRS = ["docs/", "tests/", ".github/"];

/** Ordered from most to least severe. The first matching rule wins. */
const RULES = [
  { level: "data", reason: "D1 migration", test: p => p.startsWith("drizzle/") || p === "drizzle.config.ts" },
  { level: "data", reason: "D1 schema / access", test: p => p.startsWith("db/") },
  { level: "data", reason: "hosting bindings (D1/R2/project)", test: p => p.startsWith(".openai/") },
  { level: "data", reason: "authentication helper", test: p => p === "app/chatgpt-auth.ts" },
  { level: "runtime", reason: "server API", test: p => p.startsWith("app/api/") },
  { level: "runtime", reason: "Worker entrypoint", test: p => p.startsWith("worker/") },
  { level: "runtime", reason: "dependencies", test: p => ["package.json", "package-lock.json", ".npmrc"].includes(p) },
  { level: "runtime", reason: "build / framework config", test: p => ["vite.config.ts", "next.config.ts", "tsconfig.json", "cloudflare-env.d.ts", "postcss.config.mjs", "components.json"].includes(p) || p.startsWith("scripts/vite/") || p.startsWith("vendor/") },
  { level: "app", reason: "app / UI", test: p => p.startsWith("app/") || p.startsWith("components/") || p.startsWith("hooks/") || p.startsWith("public/") },
  { level: "app", reason: "game logic / content", test: p => p.startsWith("lib/") },
  { level: "none", reason: "docs, tests, CI, repository tooling (not served)", test: p => NOT_SERVED_FILES.has(p) || NOT_SERVED_DIRS.some(d => p.startsWith(d)) },
  { level: "runtime", reason: "unclassified file: review whether it affects build or runtime", test: () => true },
];
const LEVELS = ["none", "app", "runtime", "data"];

/**
 * @param {{status: string, path: string}[]} changes  git name-status entries
 * @param {{storageKeyChanged?: boolean, packageDependenciesUnchanged?: boolean, packageScriptsServingUnchanged?: boolean}} [signals]
 */
export function classifyChanges(changes, signals = {}) {
  const entries = changes.map(({ status, path }) => {
    const rule = RULES.find(r => r.test(path));
    let level = rule.level, reason = rule.reason;
    // package.json: only changes limited to repository-maintenance scripts are harmless.
    if (path === "package.json" && status === "M" && signals.packageDependenciesUnchanged && signals.packageScriptsServingUnchanged) { level = "none"; reason = "package.json: only maintenance scripts/metadata changed"; }
    else if (path === "package.json" && status === "M" && signals.packageDependenciesUnchanged && signals.packageScriptsServingUnchanged === false) { reason = "package.json: build/start/install or lifecycle script changed"; }
    // Deleting served files can break the running Site or a rollback.
    if (/^[DR]/.test(status) && level === "app") { level = "runtime"; reason += " (deleted/renamed)"; }
    return { status, path, level, reason };
  });
  if (signals.storageKeyChanged) {
    entries.push({ status: "M", path: "app/rival-app.tsx", level: "data", reason: "localStorage key changed (kifu-rival.v*)" });
  }
  const level = entries.reduce((max, e) => LEVELS.indexOf(e.level) > LEVELS.indexOf(max) ? e.level : max, "none");
  const decision = {
    none: "No served change. A Site deploy is optional.",
    app: "Ordinary release: follow docs/RELEASE.md, no data impact expected.",
    runtime: "Review release: confirm API/Worker/dependency changes and test the built Worker before deploying.",
    data: "STOP: needs explicit user approval, a backup and a rollback plan before deploying (docs/RELEASE.md §データ).",
  }[level] ?? "";
  return { level, decision, entries };
}

/** Paths that are generated or local-only and never part of a release. Mirrors .gitignore. */
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".next", ".vinext", "out", ".wrangler", ".sites-runtime", "coverage", "outputs", "work", ".agents", ".codex", ".yarn", ".pnp"]);
const IGNORED_FILE = name => name === ".DS_Store" || name === "next-env.d.ts" || name.endsWith(".tsbuildinfo")
  || name.startsWith(".env") || name.startsWith(".dev.vars") || name.endsWith(".pem") || /-debug\.log/.test(name);

export function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex"); }

/** List files under root that a release would contain (POSIX-style relative paths). */
export function listReleaseFiles(root) {
  const out = [];
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      if (stat.isDirectory()) { if (!IGNORED_DIRS.has(name)) walk(full); }
      else if (stat.isFile() && !IGNORED_FILE(name)) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return out;
}

/** @param {Record<string,string>} expected @param {Record<string,string>} actual */
export function compareManifest(expected, actual) {
  const missing = Object.keys(expected).filter(p => !(p in actual)).sort();
  const extra = Object.keys(actual).filter(p => !(p in expected)).sort();
  const changed = Object.keys(expected).filter(p => p in actual && actual[p] !== expected[p]).sort();
  return { ok: !missing.length && !extra.length && !changed.length, missing, extra, changed };
}

/**
 * Decision recorded by a person for one Site file the sync would overwrite or delete.
 * `siteSha256` binds it to the exact content reviewed, so a later edit makes it stale.
 * @typedef {{ path: string, action: "overwrite" | "delete", siteSha256: string, reason: string, decidedBy: string }} SyncDecision
 */

/**
 * Plan a sync of `actual` (Site) towards `expected` (GitHub release) without touching files.
 * @param {Record<string,string>} expected
 * @param {Record<string,string>} actual
 * @param {SyncDecision[]} [decisions]
 */
export function planSync(expected, actual, decisions = []) {
  const add = Object.keys(expected).filter(p => !(p in actual)).sort();
  const overwrite = Object.keys(expected).filter(p => p in actual && actual[p] !== expected[p]).sort();
  const remove = Object.keys(actual).filter(p => !(p in expected)).sort();
  const decided = (path, action) => decisions.some(d => d.path === path && d.action === action && d.siteSha256 === actual[path] && d.reason?.trim() && d.decidedBy?.trim());
  const unresolved = [
    ...overwrite.filter(p => !decided(p, "overwrite")).map(path => ({ path, action: "overwrite", siteSha256: actual[path] })),
    ...remove.filter(p => !decided(p, "delete")).map(path => ({ path, action: "delete", siteSha256: actual[path] })),
  ];
  const stale = decisions.filter(d => !(d.path in actual) || actual[d.path] !== d.siteSha256).map(d => d.path).sort();
  return { add, overwrite, delete: remove, unresolved, stale, safe: unresolved.length === 0 };
}

/**
 * Cross-check an `rsync -a --delete --dry-run --itemize-changes` listing against the plan.
 * Any deletion or transfer the plan did not predict means the two views disagree: stop.
 */
export function crossCheckDryRun(plan, itemizeText) {
  const deletions = [], transfers = [];
  for (const raw of itemizeText.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("*deleting ")) { const p = line.slice(10).trim(); if (!p.endsWith("/")) deletions.push(p); continue; }
    // Only lines that move data count ("<"/">" transfer, "c" create); "." is an attribute-only update.
    const m = line.match(/^[<>c]f\S*\s+(.+)$/);
    if (m) transfers.push(m[1]);
  }
  const want = new Set([...plan.add, ...plan.overwrite]);
  const unexpectedDeletions = deletions.filter(p => !plan.delete.includes(p)).sort();
  const missedDeletions = plan.delete.filter(p => !deletions.includes(p)).sort();
  const unexpectedTransfers = transfers.filter(p => !want.has(p)).sort();
  const missedTransfers = [...want].filter(p => !transfers.includes(p)).sort();
  return { ok: !unexpectedDeletions.length && !missedDeletions.length && !unexpectedTransfers.length && !missedTransfers.length, unexpectedDeletions, missedDeletions, unexpectedTransfers, missedTransfers };
}

function hashTree(root) {
  return Object.fromEntries(listReleaseFiles(root).map(p => [p, sha256(readFileSync(join(root, p)))]));
}

function snapshot(args) {
  const root = resolve(option(args, "--root") || ".");
  const out = option(args, "--out");
  if (!out) throw new Error("snapshot requires --out <file>");
  const files = hashTree(root);
  writeFileSync(out, JSON.stringify({ schema: MANIFEST_SCHEMA, repository: "snapshot", commit: `snapshot of ${root}`, files }, null, 2) + "\n");
  console.log(`snapshot: ${Object.keys(files).length} files of ${root} -> ${out}`);
}

/** Data-level paths in the sync itself (add/overwrite/delete), using the release classification. */
export function syncLevel(plan) {
  const changes = [...plan.add.map(path => ({ status: "A", path })), ...plan.overwrite.map(path => ({ status: "M", path })), ...plan.delete.map(path => ({ status: "D", path }))];
  return classifyChanges(changes).level;
}

const APPROVAL_FIELDS = ["approvedBy", "approvedOn", "scope", "d1Backup", "rollbackPlan"];

/**
 * Combine every pre-sync gate. `automated` gates are verified by this tool; `manual` gates
 * can only be checked for a complete record, so they are reported separately and never
 * described as verified.
 */
export function evaluateGates({ plan, dryRun, snapshotMatchesSite, archiveMatchesSnapshot, dataApproval }) {
  const level = syncLevel(plan);
  const automated = [
    { gate: "file differences decided", ok: plan.safe, detail: `${plan.unresolved.length} unresolved, ${plan.stale.length} stale` },
    { gate: "rsync dry-run matches the plan", ok: !!dryRun && dryRun.ok, detail: dryRun ? JSON.stringify(dryRun) : "no --rsync-dry-run given" },
    { gate: "backup snapshot matches the Site now", ok: snapshotMatchesSite === true, detail: snapshotMatchesSite === null ? "no --backup-snapshot given" : "" },
    { gate: "backup archive restores to the snapshot", ok: archiveMatchesSnapshot === true, detail: archiveMatchesSnapshot === null ? "no --backup-archive given" : "" },
  ];
  const missing = dataApproval ? APPROVAL_FIELDS.filter(f => !String(dataApproval[f] ?? "").trim()) : APPROVAL_FIELDS;
  const manual = [
    { gate: "data change approval recorded (presence only, not verified)", required: level === "data", ok: level !== "data" || missing.length === 0, detail: level === "data" ? (missing.length ? `missing: ${missing.join(", ")}` : "record present") : "not required (no data-level path in this sync)" },
  ];
  return { level, automated, manual, passed: automated.every(g => g.ok) && manual.every(g => g.ok) };
}

function archiveMatches(archive, expected) {
  const dir = mkdtempSync(join(tmpdir(), "kifu-restore-"));
  try {
    execFileSync("tar", ["-xzf", archive, "-C", dir]);
    return compareManifest(expected, hashTree(dir)).ok;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function preflight(args) {
  const valueOptions = ["--root", "--decisions", "--rsync-dry-run", "--out", "--backup-snapshot", "--backup-archive", "--data-approval"].map(o => option(args, o));
  const file = args.find(a => !a.startsWith("--") && !valueOptions.includes(a));
  if (!file) throw new Error("preflight requires <manifest.json>");
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data.schema !== MANIFEST_SCHEMA || !data.files) throw new Error("Unsupported manifest");
  const root = resolve(option(args, "--root") || ".");
  const read = name => { const f = option(args, name); return f ? readFileSync(f, "utf8") : null; };
  const decisions = JSON.parse(read("--decisions") ?? "[]");
  const site = hashTree(root);
  const plan = planSync(data.files, site, decisions);
  const dryRunText = read("--rsync-dry-run");
  const dryRun = dryRunText === null ? null : crossCheckDryRun(plan, dryRunText);
  const snapshotText = read("--backup-snapshot");
  const snapshot = snapshotText ? JSON.parse(snapshotText).files : null;
  const snapshotMatchesSite = snapshot ? compareManifest(snapshot, site).ok : null;
  const archive = option(args, "--backup-archive");
  const archiveMatchesSnapshot = archive && snapshot ? archiveMatches(archive, snapshot) : archive ? false : null;
  const approvalText = read("--data-approval");
  const gates = evaluateGates({ plan, dryRun, snapshotMatchesSite, archiveMatchesSnapshot, dataApproval: approvalText ? JSON.parse(approvalText) : null });

  console.log(`preflight (read-only): ${root} -> ${data.repository}@${data.commit}`);
  console.log(`  add ${plan.add.length}, overwrite ${plan.overwrite.length}, delete ${plan.delete.length}; level of this sync: ${gates.level}`);
  for (const u of plan.unresolved) console.log(`  UNRESOLVED ${u.action}: ${u.path}`);
  for (const p of plan.stale) console.log(`  stale decision (file changed or gone since review): ${p}`);
  console.log("  automated gates (verified by this tool):");
  for (const g of gates.automated) console.log(`    [${g.ok ? "ok" : "NG"}] ${g.gate}${g.detail ? ` — ${g.detail}` : ""}`);
  console.log("  manual gates (a person is responsible; the tool only checks that a record exists):");
  for (const g of gates.manual) console.log(`    [${g.ok ? "ok" : "NG"}] ${g.gate} — ${g.detail}`);
  const out = option(args, "--out");
  if (out) writeFileSync(out, JSON.stringify({ manifest: data.commit, root, plan, gates,
    decisionTemplate: plan.unresolved.map(u => ({ ...u, reason: "", decidedBy: "" })) }, null, 2) + "\n");
  console.log(gates.passed
    ? "preflight: GATES PASSED. The sync may proceed. This does NOT confirm the post-deploy checks (private access, iPhone smoke test) in docs/RELEASE.md §4-5."
    : "preflight: STOP — do not sync. Resolve every NG gate above (bring Site-only changes into GitHub by PR, record per-file decisions, take and verify the backup), then re-run.");
  if (!gates.passed) process.exitCode = 3;
}

function git(args, cwd) { return execFileSync("git", args, { cwd, encoding: "utf8" }); }
function option(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides", "engines", "packageManager", "workspaces"];
/** True when package.json changed only outside the fields that affect what gets installed or run. */
export function sameDependencies(before, after) {
  return DEPENDENCY_FIELDS.every(field => JSON.stringify(before?.[field] ?? null) === JSON.stringify(after?.[field] ?? null));
}
/**
 * npm scripts that only maintain the repository (checks, tests, release tooling).
 * Every other script (build, dev, start, install:ci, db:*, npm lifecycle hooks such as
 * preinstall/postinstall/prepare, and any new name) may affect deployment.
 */
const MAINTENANCE_SCRIPT = /^(lint|test(:[\w-]+)?|ledger:check|public:check|release:(plan|manifest|snapshot|preflight|verify))$/;
export function isMaintenanceScript(name) { return MAINTENANCE_SCRIPT.test(name); }
/** True when every added, removed or edited npm script is a maintenance script. */
export function servingScriptsUnchanged(before, after) {
  const a = before?.scripts ?? {}, b = after?.scripts ?? {};
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every(name => a[name] === b[name] || isMaintenanceScript(name));
}
function readPackages(base, head, root) {
  try { return [JSON.parse(git(["show", `${base}:package.json`], root)), JSON.parse(git(["show", `${head}:package.json`], root))]; }
  catch { return null; }
}

function plan(args, root) {
  const base = option(args, "--base"), head = option(args, "--head") || "HEAD";
  if (!base) throw new Error("plan requires --base <sha of the commit currently deployed>");
  const changes = git(["diff", "--name-status", "--no-renames", `${base}..${head}`], root).trim().split("\n").filter(Boolean)
    .map(line => { const [status, path] = line.split("\t"); return { status, path }; });
  const appDiff = git(["diff", "-U0", `${base}..${head}`, "--", "app/rival-app.tsx"], root);
  const storageKeyChanged = /^[-+].*STORAGE_KEY\s*=/m.test(appDiff);
  const pkgs = readPackages(base, head, root);
  const result = classifyChanges(changes, {
    storageKeyChanged,
    packageDependenciesUnchanged: pkgs ? sameDependencies(pkgs[0], pkgs[1]) : false,
    packageScriptsServingUnchanged: pkgs ? servingScriptsUnchanged(pkgs[0], pkgs[1]) : false,
  });
  const headSha = git(["rev-parse", head], root).trim();
  console.log(`release plan ${base.slice(0, 12)}..${headSha.slice(0, 12)}: level=${result.level}`);
  for (const e of result.entries) console.log(`  [${e.level}] ${e.status} ${e.path} — ${e.reason}`);
  console.log(result.decision);
  if (result.level === "data") process.exitCode = 2;
}

function manifest(args, root) {
  if (git(["status", "--porcelain", "--untracked-files=no"], root).trim()) throw new Error("Working tree has uncommitted changes; check out the exact release commit first");
  const commit = git(["rev-parse", "HEAD"], root).trim();
  const tracked = git(["ls-files", "-z"], root).split("\0").filter(Boolean).sort();
  const files = Object.fromEntries(tracked.map(p => [p, sha256(readFileSync(join(root, p)))]));
  const body = JSON.stringify({ schema: MANIFEST_SCHEMA, repository: "setisunyuma/kifu-rival", commit, files }, null, 2) + "\n";
  const out = option(args, "--out");
  if (out) { writeFileSync(out, body); console.log(`manifest: ${tracked.length} files at ${commit} -> ${out}`); }
  else process.stdout.write(body);
}

function verify(args) {
  const file = args.find(a => !a.startsWith("--") && a !== option(args, "--root"));
  if (!file) throw new Error("verify requires <manifest.json>");
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data.schema !== MANIFEST_SCHEMA || !data.files) throw new Error("Unsupported manifest");
  const root = resolve(option(args, "--root") || ".");
  const actual = Object.fromEntries(listReleaseFiles(root).map(p => [p, sha256(readFileSync(join(root, p)))]));
  const result = compareManifest(data.files, actual);
  for (const [label, list] of [["missing", result.missing], ["changed", result.changed], ["extra", result.extra]]) {
    for (const p of list) console.log(`  ${label}: ${p}`);
  }
  console.log(result.ok
    ? `verify: OK — ${root} matches ${data.repository}@${data.commit} (${Object.keys(data.files).length} files)`
    : `verify: MISMATCH — ${result.missing.length} missing, ${result.changed.length} changed, ${result.extra.length} extra. Do not deploy.`);
  if (!result.ok) process.exitCode = 1;
}

// Run the CLI only when this file itself is executed (not when imported or bundled into tests).
if (/release\.mjs$/.test(process.argv[1] ?? "") && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  // plan/manifest operate on the Git checkout the operator is standing in.
  const root = () => git(["rev-parse", "--show-toplevel"], process.cwd()).trim();
  try {
    if (command === "plan") plan(args, root());
    else if (command === "manifest") manifest(args, root());
    else if (command === "verify") verify(args);
    else if (command === "snapshot") snapshot(args);
    else if (command === "preflight") preflight(args);
    else throw new Error("Usage: node scripts/release.mjs plan|manifest|snapshot|preflight|verify (see header comment)");
  } catch (error) {
    console.error(`release: ${error.message}`);
    process.exitCode = 1;
  }
}
