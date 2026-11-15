import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const esbuild = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "esbuild.cmd" : "esbuild");
if (!existsSync(esbuild)) {
  console.error("Run npm ci before test:unit (esbuild binary not installed)");
  process.exit(1);
}

const output = resolve(root, ".sites-runtime", "unit-tests");
mkdirSync(output, { recursive: true });
const sources = ["tests/shogi.spec.ts", "tests/rival-chat.spec.ts", "tests/guarded-auto-merge.spec.ts", "tests/backup.spec.ts", "tests/learning.spec.ts", "tests/persistence.spec.ts"];
const bundlerArguments = [
  ...sources.map(file => resolve(root, file)),
  "--bundle", "--platform=node", "--format=esm", `--outdir=${output}`,
];

execFileSync(esbuild, bundlerArguments, { cwd: root, stdio: "inherit" });
const compiled = sources.map(file => resolve(output, file.replace(/^tests\//, "").replace(/\.ts$/, ".js")));
execFileSync(process.execPath, ["--test", ...compiled], { cwd: root, stdio: "inherit" });
