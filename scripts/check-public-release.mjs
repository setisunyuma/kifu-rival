import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Lightweight defense-in-depth for a PUBLIC source repository.
// This is a guard, not a substitute for human review of files or Git history.
const root = resolve(import.meta.dirname, "..");
const excludedTextScan = new Set(["scripts/check-public-release.mjs"]); // Contains detection patterns.
const forbiddenFiles = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)\.dev\.vars(?:\.|$)/i,
  /(^|\/)(?:\.git|\.wrangler|\.sites-runtime|node_modules)(?:\/|$)/i,
  /(^|\/)(?:id_rsa|id_ed25519|credentials\.json|service[-_]?account[^/]*)$/i,
  /\.(?:pem|p12|pfx|key|sqlite|sqlite3|db)$/i,
];
const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["OpenAI-style API secret", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9_]{24,}|github_pat_[A-Za-z0-9_]{24,})/],
  ["populated credential variable", /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[:=]\s*['"]?[A-Za-z0-9_-]{12,}/],
  ["non-example email", /\b[A-Z0-9._%+-]+@(?!example\.(?:com|org|net)\b|sites\.test\b|users\.noreply\.github\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
];

const errors = [];
let files;
try {
  files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
} catch {
  console.error("public-check: Git tracked-file inventory unavailable");
  process.exit(1);
}

let textCount = 0;
for (const path of files) {
  if (forbiddenFiles.some((regex) => regex.test(path))) {
    errors.push(`${path}: forbidden tracked path (review and remove from public export)`);
    continue;
  }
  if (excludedTextScan.has(path)) continue;
  const fullPath = resolve(root, path);
  const stats = statSync(fullPath);
  if (!stats.isFile()) continue;
  if (stats.size > 10 * 1024 * 1024) {
    errors.push(`${path}: file over 10 MiB requires manual public review`);
    continue;
  }
  const raw = readFileSync(fullPath);
  if (raw.includes(0)) continue; // Binary assets require manual licensing/privacy review.
  const content = raw.toString("utf8");
  textCount++;
  for (const [label, regex] of patterns) {
    if (regex.test(content)) errors.push(`${path}: potential ${label}; review without pasting the value into logs`);
  }
}

if (errors.length) {
  errors.forEach((error) => console.error(`public-check: ${error}`));
  console.error(`public-check: FAIL — ${errors.length} finding(s). Check docs/PUBLIC_RELEASE_CHECKLIST.md`);
  process.exit(1);
}
console.log(`public-check: PASS — ${files.length} tracked files, ${textCount} text files screened`);
console.log("public-check: Does not inspect untracked data, deleted Git history, or binary asset contents; manual review required.");
