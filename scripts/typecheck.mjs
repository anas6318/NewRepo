/**
 * `npm run typecheck` entry. Picks the right tsconfig automatically:
 *  - node_modules/@types/react present (normal machine after npm install)
 *    → tsconfig.json (real React types)
 *  - otherwise (network-restricted environment) → tsconfig.sandbox.json
 *    (local React shim; identical strictness for all application code)
 * Exit code is tsc's exit code either way — no result is faked.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hasReactTypes = existsSync(join(root, "node_modules", "@types", "react", "package.json"));
const project = hasReactTypes ? "tsconfig.json" : "tsconfig.sandbox.json";
console.log(`typecheck: using ${project}${hasReactTypes ? "" : " (no @types/react in node_modules — sandbox shim)"}`);
const res = spawnSync("tsc", ["-p", join(root, project)], { stdio: "inherit", cwd: root, shell: process.platform === "win32" });
process.exit(res.status ?? 1);
