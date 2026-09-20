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

// Concurrent runExperiment jobs (core/runner.js now fires up to the limiter's
// concurrency ceiling at once) can all resolve around the same time. Node's
// fs.appendFile is not guaranteed atomic across concurrent calls on every
// platform, so two writes landing together could interleave into one
// corrupted line. A single in-process queue serializes them; cheap, since
// this all happens within one Node process.
let writeQueue = Promise.resolve();

export async function appendRecord(experimentName, record) {
  const line = `${JSON.stringify(record)}\n`;
  const file = rawPath(experimentName);
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(RAW_DIR, { recursive: true });
    await fs.appendFile(file, line, "utf8");
  });
  await writeQueue;
}
