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
 *   node scripts/release.mjs verify <manifest.json> [--root <dir>]
 *       Compare a directory (e.g. the Sites source checkout) against the manifest.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const MAINTENANCE_SCRIPT = /^(lint|test(:[\w-]+)?|ledger:check|public:check|release:(plan|manifest|verify))$/;
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
    else throw new Error("Usage: node scripts/release.mjs plan|manifest|verify (see header comment)");
  } catch (error) {
    console.error(`release: ${error.message}`);
    process.exitCode = 1;
  }
}
