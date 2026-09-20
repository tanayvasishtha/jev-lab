/**
 * BoolQ loader. Tries GCS JSONL first; falls back to HuggingFace parquet via hyparquet.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asyncBufferFromUrl, parquetReadObjects } from "hyparquet";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data", "datasets");

const GCS_TRAIN = "https://storage.googleapis.com/boolq/train.jsonl";
const GCS_DEV = "https://storage.googleapis.com/boolq/dev.jsonl";
const HF_TRAIN =
  "https://huggingface.co/datasets/google/boolq/resolve/main/data/train-00000-of-00001.parquet";
const HF_VAL =
  "https://huggingface.co/datasets/google/boolq/resolve/main/data/validation-00000-of-00001.parquet";

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function normalize(obj, split, index) {
  const question = obj.question ?? obj.Query ?? obj.query;
  const passage = obj.passage ?? obj.Passage ?? obj.context;
  let answer = obj.answer ?? obj.Answer ?? obj.label;
  if (typeof answer === "string") {
    answer = ["true", "yes", "1"].includes(answer.toLowerCase());
  }
  if (typeof question !== "string" || typeof passage !== "string") {
    throw new Error(`BoolQ row missing question/passage at ${split}#${index}`);
  }
  if (typeof answer !== "boolean") {
    throw new Error(`BoolQ row missing boolean answer at ${split}#${index}`);
  }
  return {
    id: `${split}-${index}`,
    split,
    question,
    passage,
    label: answer,
  };
}

function parseJsonl(text, split) {
  const rows = [];
  for (const line of text.split(/\n+/)) {
    if (!line.trim()) continue;
    rows.push(normalize(JSON.parse(line), split, rows.length));
  }
  return rows;
}

async function loadFromGcs() {
  const [trainText, devText] = await Promise.all([
    fetchText(GCS_TRAIN),
    fetchText(GCS_DEV),
  ]);
  return [...parseJsonl(trainText, "train"), ...parseJsonl(devText, "dev")];
}

async function loadFromHfParquet() {
  async function readSplit(url, split) {
    const file = await asyncBufferFromUrl({ url });
    const rows = await parquetReadObjects({ file });
    return rows.map((obj, i) => normalize(obj, split, i));
  }
  const [train, val] = await Promise.all([
    readSplit(HF_TRAIN, "train"),
    readSplit(HF_VAL, "dev"),
  ]);
  return [...train, ...val];
}

export async function loadBoolQ() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const snapshot = path.join(DATA_DIR, "boolq.json");
  try {
    const parsed = JSON.parse(await fs.readFile(snapshot, "utf8"));
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }

  let rows;
  let source;
  try {
    console.log("BoolQ: trying GCS JSONL…");
    rows = await loadFromGcs();
    source = "gcs-jsonl";
  } catch (gcsErr) {
    console.warn(
      `BoolQ: GCS failed (${gcsErr.message}); falling back to HuggingFace parquet.`,
    );
    try {
      rows = await loadFromHfParquet();
      source = "hf-parquet";
    } catch (hfErr) {
      throw new Error(
        `BoolQ download failed. GCS: ${gcsErr.message}; HuggingFace parquet: ${hfErr.message}. Not substituting another dataset.`,
      );
    }
  }

  await fs.writeFile(snapshot, JSON.stringify(rows), "utf8");
  console.log(`BoolQ: loaded ${rows.length} rows via ${source}`);
  return rows;
}

export function sample(rows, n, seed = 42) {
  if (n > rows.length) {
    throw new Error(`sample size ${n} > dataset size ${rows.length}`);
  }
  const rand = mulberry32(seed);
  const idx = Array.from({ length: rows.length }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map((i) => rows[i]);
}
