/**
 * `npm run von`: starts the local Von server via jev-race/start-von.py,
 * using the Python in .venv-von (see README for the one-time setup).
 * A Node wrapper so the venv path works on Windows cmd and on macOS/Linux.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.platform === "win32"
  ? path.join(ROOT, ".venv-von", "Scripts", "python.exe")
  : path.join(ROOT, ".venv-von", "bin", "python");

if (!existsSync(python)) {
  console.error(`No Von environment found at ${python}. See "Adding Von" in README.md for the one-time setup.`);
  process.exit(1);
}

const child = spawn(python, [path.join(ROOT, "jev-race", "start-von.py")], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
