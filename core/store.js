import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = path.join(ROOT, "data", "raw");

export function rawPath(experimentName) {
  return path.join(RAW_DIR, `${experimentName}.jsonl`);
}

export async function readExistingIds(experimentName) {
  const file = rawPath(experimentName);
  const ids = new Set();
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return ids;
    throw err;
  }
  for (const line of text.split(/\n+/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.id != null) ids.add(String(row.id));
    } catch {
      // skip corrupt line
    }
  }
  return ids;
}

export async function appendRecord(experimentName, record) {
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.appendFile(rawPath(experimentName), `${JSON.stringify(record)}\n`, "utf8");
}
