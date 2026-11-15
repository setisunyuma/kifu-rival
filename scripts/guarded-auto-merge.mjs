/**
 * GitHub Actions only: safely merge a trusted, fully-tested PR without a human
 * clicking "Merge". No PR checkout or execution of PR-provided scripts.
 *
 * Keep the allowlist deliberately narrow. Changes to this file, CI, hosting,
 * auth, dependencies, database, and deployment always require manual review.
 */
import { readFileSync } from "node:fs";

export const REPOSITORY = "setisunyuma/kifu-rival";
export const OWNER = "setisunyuma";

const EXACT_SAFE_FILES = new Set([
  "README.md",
  "app/globals.css",
  "app/layout.tsx",
  "app/page.tsx",
  "app/rival-app.tsx",
  "docs/ARCHITECTURE.md",
  "docs/ENGINE_INTEGRATION_PLAN.md",
  "docs/ROADMAP.md",
  "docs/ledger/WORK_ITEMS.md",
  "docs/ledger/SESSION_LOG.md",
  "docs/ledger/QUALITY_GATES.md",
  "lib/shogi.ts",
  "lib/lessons.ts",
  "lib/rival-chat.ts",
  "lib/utils.ts",
]);
const SAFE_PREFIXES = ["components/", "hooks/", "tests/"];

export function isSafePath(path) {
  if (typeof path !== "string" || path.startsWith("/") || path.includes("..") || path.includes("\\")) return false;
  return EXACT_SAFE_FILES.has(path) || SAFE_PREFIXES.some(prefix => path.startsWith(prefix));
}

export function assessMerge({ run, pr, mergeCommit, files }) {
  const refuse = reason => ({ allowed: false, reason });
  if (!run || run.event !== "pull_request" || run.conclusion !== "success") return refuse("Source validation did not succeed on a pull request");
  if (!/^\.github\/workflows\/verify\.yml(?:@|$)/.test(run.path || "")) return refuse("Unexpected validation workflow path");
  if (run.head_repository?.full_name !== REPOSITORY) return refuse("Validation run originated from a fork");
  if (!Array.isArray(run.pull_requests) || run.pull_requests.length !== 1) return refuse("Cannot unambiguously identify the tested PR");
  if (!pr || run.pull_requests[0].number !== pr.number) return refuse("PR identity differs from CI run");
  if (pr.state !== "open" || pr.draft) return refuse("PR is closed or draft");
  if (pr.mergeable !== true) return refuse("PR is not currently confirmed mergeable");
  if (pr.base?.ref !== "main" || pr.base?.repo?.full_name !== REPOSITORY) return refuse("Unexpected base repository/branch");
  if (pr.head?.repo?.full_name !== REPOSITORY || pr.head?.ref === "main") return refuse("Fork or unexpected head branch");
  if (pr.user?.login !== OWNER) return refuse("PR author is not the approved repository owner");
  if ((pr.labels || []).some(x => ["manual-review", "no-auto-merge"].includes(x.name)) || /^\[manual\]/i.test(pr.title || "")) return refuse("Manual review explicitly requested");
  // workflow_run.head_sha identifies the PR's head commit. The run's PR base
  // SHA is needed too: without it we cannot prove that CI tested today's main.
  // Some GitHub payloads omit that base SHA; those fail closed.
  if (run.head_sha !== pr.head?.sha || run.pull_requests[0].head?.sha !== pr.head?.sha) return refuse("CI tested an older/different PR head");
  if (!run.pull_requests[0].base?.sha || run.pull_requests[0].base.sha !== pr.base?.sha) return refuse("CI base SHA missing or main changed since tests");
  if (!pr.merge_commit_sha || mergeCommit?.sha !== pr.merge_commit_sha) return refuse("Current test merge commit missing");
  const parents = mergeCommit?.parents || [];
  if (parents.length !== 2 || parents[0]?.sha !== pr.base?.sha || parents[1]?.sha !== pr.head?.sha) return refuse("Test merge parents do not match current base and PR head");
  if (!Array.isArray(files) || files.length === 0 || files.length !== pr.changed_files || files.length > 30) return refuse("Changed-file list missing or exceeds 30 files");
  if (files.some(file => !isSafePath(file.filename) || file.status === "renamed" || file.status === "removed")) return refuse("Sensitive, new integration, removed, or unapproved file path changed");
  if (files.reduce((count, file) => count + (file.additions || 0) + (file.deletions || 0), 0) > 1200) return refuse("Diff exceeds 1200 changed lines");
  return { allowed: true, reason: "Trusted owner PR; current merged result passed all source checks; paths and size within auto-merge policy" };
}

async function githubAPI(path, token, method = "GET", body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const output = await response.text();
  if (!response.ok) throw new Error(`GitHub REST ${method} ${path}: HTTP ${response.status}, ${output.slice(0, 240)}`);
  return output ? JSON.parse(output) : null;
}

export async function runGuardedMerge({ token, eventPath, repository }) {
  if (repository !== REPOSITORY) throw new Error("Unexpected repository; stop before acquiring write access");
  if (!token || !eventPath) throw new Error("GitHub Actions token or event path missing");
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const run = event.workflow_run;
  if (!run || run.event !== "pull_request" || run.conclusion !== "success") return console.log("Skipped: not a successful PR validation run");
  if (!Array.isArray(run.pull_requests) || run.pull_requests.length !== 1) return console.log("Skipped: CI run does not uniquely identify a PR");

  const prefix = `/repos/${REPOSITORY}`;
  const number = run.pull_requests[0].number;
  if (!Number.isInteger(number) || number < 1) return console.log("Skipped: invalid PR number");
  const pr = await githubAPI(`${prefix}/pulls/${number}`, token);
  if (!pr.merge_commit_sha) return console.log(`Manual review: PR #${number}: test merge SHA missing`);
  const mergeCommit = await githubAPI(`${prefix}/git/commits/${encodeURIComponent(pr.merge_commit_sha)}`, token);
  const files = await githubAPI(`${prefix}/pulls/${number}/files?per_page=100`, token);
  let assessment = assessMerge({ run, pr, mergeCommit, files });
  if (!assessment.allowed) return console.log(`Manual review: PR #${number}: ${assessment.reason}`);

  // Close the TOCTOU gap as much as the REST API permits. The merge call itself
  // also pins the exact PR head SHA; branch rules remain enforced by GitHub.
  const latest = await githubAPI(`${prefix}/pulls/${number}`, token);
  assessment = assessMerge({ run, pr: latest, mergeCommit, files });
  if (!assessment.allowed) return console.log(`Manual review: PR #${number} changed during verification: ${assessment.reason}`);

  const result = await githubAPI(`${prefix}/pulls/${number}/merge`, token, "PUT", {
    sha: latest.head.sha,
    merge_method: "squash",
    commit_title: `${latest.title} (#${number})`,
  });
  if (!result?.merged) throw new Error(`PR #${number} was not merged`);
  console.log(`Squash-merged PR #${number} at ${result.sha}; Site deployment is separate and remains private.`);
}

if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_EVENT_NAME === "workflow_run") {
  runGuardedMerge({
    token: process.env.GITHUB_TOKEN,
    eventPath: process.env.GITHUB_EVENT_PATH,
    repository: process.env.GITHUB_REPOSITORY,
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
