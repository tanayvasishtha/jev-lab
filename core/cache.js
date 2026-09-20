import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, "data", "cache");

export function cacheKey({ state, questions, model }) {
  return createHash("sha256")
    .update(JSON.stringify({ state, questions, model }))
    .digest("hex");
}

function cachePath(key) {
  return path.join(CACHE_DIR, key.slice(0, 2), `${key}.json`);
}

export async function cacheGet(key) {
  try {
    return JSON.parse(await fs.readFile(cachePath(key), "utf8"));
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

export async function cacheSet(key, value) {
  const file = cachePath(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value), "utf8");
}
