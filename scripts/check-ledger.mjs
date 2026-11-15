import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const requiredFiles = [
  "README.md", "AGENTS.md", "CLAUDE.md",
  "docs/PRODUCT_VISION.md", "docs/ARCHITECTURE.md", "docs/ROADMAP.md",
  "docs/OPERATIONS.md", "docs/HANDOFF_TO_CLAUDE.md",
  "docs/PUBLIC_RELEASE_CHECKLIST.md", "docs/ENGINE_INTEGRATION_PLAN.md",
  "docs/ledger/README.md", "docs/ledger/WORK_ITEMS.md",
  "docs/ledger/DECISIONS.md", "docs/ledger/OPEN_QUESTIONS.md",
  "docs/ledger/SESSION_LOG.md", "docs/ledger/QUALITY_GATES.md",
];
const errors = [];
const files = new Map();

for (const path of requiredFiles) {
  try {
    const content = readFileSync(resolve(root, path), "utf8");
    if (!content.trim()) errors.push(`${path}: empty`);
    files.set(path, content);
  } catch {
    errors.push(`${path}: missing`);
  }
}

const work = files.get("docs/ledger/WORK_ITEMS.md") || "";
const headings = [...work.matchAll(/^## (KIF-\d{3}) — (.+)$/gm)];
const validStatuses = new Set(["BACKLOG", "READY", "IN_PROGRESS", "BLOCKED", "VERIFIED", "PARKED"]);
const requiredFields = ["Status", "Priority", "Owner", "Depends", "Acceptance", "Evidence", "Next"];
const IDs = new Set();

for (let index = 0; index < headings.length; index++) {
  const [heading, id] = headings[index];
  if (IDs.has(id)) errors.push(`${id}: duplicate ID`);
  IDs.add(id);
  const start = (headings[index].index ?? 0) + heading.length;
  const end = headings[index + 1]?.index ?? work.length;
  const block = work.slice(start, end);
  for (const field of requiredFields) {
    const match = block.match(new RegExp(`^- ${field}: (.+)$`, "m"));
    if (!match || !match[1].trim()) errors.push(`${id}: missing ${field}`);
    if (field === "Status" && match && !validStatuses.has(match[1].trim())) errors.push(`${id}: unknown status ${match[1]}`);
  }
}

if (headings.length < 8) errors.push(`Only ${headings.length} work items; expected >=8`);
for (const id of ["KIF-001", "KIF-002", "KIF-010", "KIF-020", "KIF-030", "KIF-040", "KIF-050", "KIF-060"]) {
  if (!IDs.has(id)) errors.push(`Required work item ${id} is absent`);
}

const log = files.get("docs/ledger/SESSION_LOG.md") || "";
if (!/^## \d{4}-\d{2}-\d{2} — .+/m.test(log)) errors.push("SESSION_LOG.md: missing dated entry");
const decisions = files.get("docs/ledger/DECISIONS.md") || "";
if (!/^## ADR-\d{3} — .+/m.test(decisions)) errors.push("DECISIONS.md: missing ADR entry");

if (errors.length) {
  for (const error of errors) console.error(`ledger: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`ledger: OK — ${requiredFiles.length} documents, ${headings.length} unique work items, required fields present`);
  console.log("ledger: structural validation only; evidence and product behavior must be reviewed separately");
}
