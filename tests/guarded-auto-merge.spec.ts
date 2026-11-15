import assert from "node:assert/strict";
import test from "node:test";
import { assessMerge, isSafePath, REPOSITORY, OWNER } from "../scripts/guarded-auto-merge.mjs";

function fixture() {
  const base = "a".repeat(40);
  const head = "b".repeat(40);
  const merged = "c".repeat(40);
  const run = {
    event: "pull_request", conclusion: "success", head_sha: head,
    path: ".github/workflows/verify.yml@refs/pull/7/merge", head_repository: { full_name: REPOSITORY },
    pull_requests: [{ number: 7, head: { sha: head }, base: { sha: base } }],
  };
  const pr = {
    number: 7, state: "open", draft: false, mergeable: true, title: "Improve rival moves", labels: [],
    base: { ref: "main", sha: base, repo: { full_name: REPOSITORY } },
    head: { ref: "claude/improve-rival", sha: head, repo: { full_name: REPOSITORY } },
    user: { login: OWNER }, merge_commit_sha: merged, changed_files: 3,
  };
  const mergeCommit = { sha: merged, parents: [{ sha: base }, { sha: head }] };
  const files = [
    { filename: "lib/shogi.ts", status: "modified", additions: 20, deletions: 4 },
    { filename: "tests/shogi.spec.ts", status: "modified", additions: 15, deletions: 0 },
    { filename: "docs/ledger/SESSION_LOG.md", status: "modified", additions: 5, deletions: 0 },
  ];
  return { run, pr, mergeCommit, files };
}

test("trusted, tested, small owner PR is eligible", () => {
  assert.equal(assessMerge(fixture()).allowed, true);
});

test("fail closed for untrusted and stale runs", () => {
  for (const modify of [
    (f: ReturnType<typeof fixture>) => { f.run.conclusion = "failure"; },
    (f: ReturnType<typeof fixture>) => { f.run.pull_requests = []; },
    (f: ReturnType<typeof fixture>) => { f.pr.user.login = "stranger"; },
    (f: ReturnType<typeof fixture>) => { f.pr.head.repo.full_name = "stranger/fork"; },
    (f: ReturnType<typeof fixture>) => { f.pr.merge_commit_sha = "d".repeat(40); },
    (f: ReturnType<typeof fixture>) => { f.run.head_sha = "d".repeat(40); },
    (f: ReturnType<typeof fixture>) => { f.run.pull_requests[0].base.sha = "d".repeat(40); },
    (f: ReturnType<typeof fixture>) => { f.run.path = ".github/workflows/fake.yml"; },
    (f: ReturnType<typeof fixture>) => { f.mergeCommit.parents[0].sha = "d".repeat(40); },
    (f: ReturnType<typeof fixture>) => { f.pr.draft = true; },
    (f: ReturnType<typeof fixture>) => { f.pr.labels.push({ name: "manual-review" } as never); },
    (f: ReturnType<typeof fixture>) => { f.pr.title = "[manual] human review"; },
  ]) {
    const sample = fixture();
    modify(sample);
    assert.equal(assessMerge(sample).allowed, false);
  }
});

test("source, policy, infrastructure, and data changes are manual-only", () => {
  for (const filename of [
    ".github/workflows/verify.yml", ".github/workflows/guarded-auto-merge.yml",
    "scripts/guarded-auto-merge.mjs", "package.json", "package-lock.json",
    "app/api/progress/route.ts", "app/chatgpt-auth.ts", "db/schema.ts",
    "drizzle/0001_unsafe.sql", "worker/index.ts", ".openai/hosting.json",
    "AGENTS.md", "CLAUDE.md", "docs/ledger/DECISIONS.md",
    "docs/OPERATIONS.md", "public/unknown-binary.wasm", "lib/new-unreviewed-engine.ts",
  ]) {
    assert.equal(isSafePath(filename), false, filename);
    const sample = fixture();
    sample.files[0].filename = filename;
    assert.equal(assessMerge(sample).allowed, false, filename);
  }
});

test("oversized, deleted, or incomplete diffs never auto-merge", () => {
  for (const modify of [
    (f: ReturnType<typeof fixture>) => { f.files[0].status = "removed"; },
    (f: ReturnType<typeof fixture>) => { f.files[0].additions = 1201; },
    (f: ReturnType<typeof fixture>) => { f.files.splice(0, 1); },
  ]) {
    const sample = fixture();
    modify(sample);
    assert.equal(assessMerge(sample).allowed, false);
  }
});
