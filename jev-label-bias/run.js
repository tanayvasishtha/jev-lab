/**
 * Label-bias collection. Method locked in PREREGISTER.md.
 * Usage: node jev-label-bias/run.js --limit 50 --yes
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runExperiment, choice, parseArgs } from "../core/runner.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(ROOT, ".env") });

const EXPERIMENT = "jev-label-bias";
const N_TICKETS = 1000;

const CATEGORIES = {
  billing: {
    criteria: "Handles payment charges, refunds, invoices, and billing discrepancies.",
    templates: [
      "I was charged {amount} twice for my {product} subscription this month.",
      "My invoice shows {amount} but I was quoted a different price for {product}.",
      "I need a refund of {amount} for {product}, it was billed in error.",
    ],
  },
  technical: {
    criteria: "Handles bugs, error messages, crashes, and product malfunctions.",
    templates: [
      "The {product} app crashes every time I try to open the settings page.",
      "I'm getting an error message when I try to sync my {product} account.",
      "{product} stopped working after the latest update, showing a blank screen.",
    ],
  },
  sales: {
    criteria: "Handles pricing questions, plan upgrades, and new purchase inquiries.",
    templates: [
      "I want to upgrade my {product} plan, what are the pricing tiers?",
      "Can you tell me if {product} offers a discount for annual billing?",
      "I'm interested in buying {product} for my team, what are the options?",
    ],
  },
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);
const PRODUCTS = ["Acme Cloud", "Zenith CRM", "Northwind Analytics", "Vertex Storage", "Pinecone Mail", "Bramble Docs", "Solace Chat", "Ironclad Backup"];
const AMOUNTS = ["$12.99", "$29.00", "$49.50", "$99.00", "$150.00", "$8.25"];

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function shuffled(rand, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Deterministically build one ticket: text, true category, and a fixed
 * slot order (which category sits in "slot 0/1/2") reused by every scheme. */
function buildTicket(index) {
  const rand = mulberry32(42 + index);
  const trueCategory = pick(rand, CATEGORY_KEYS);
  const template = pick(rand, CATEGORIES[trueCategory].templates);
  const product = pick(rand, PRODUCTS);
  const amount = pick(rand, AMOUNTS);
  const text = template.replace("{product}", product).replace("{amount}", amount);
  const slotOrder = shuffled(rand, CATEGORY_KEYS); // e.g. ["sales", "billing", "technical"]

  return {
    id: `ticket-${index}`,
    state: `Customer message: "${text}"`,
    trueCategory,
    slotOrder,
  };
}

/** Given a ticket and a scheme's key-per-slot assignment, build the choice()
 * criteria map, plus the key->category map so analyze.js can compare choices
 * across schemes by what they MEAN, not by their (always-different) key
 * strings. */
function buildCriteria(ticket, keyForSlot) {
  const criteria = {};
  const keyToCategory = {};
  ticket.slotOrder.forEach((category, slot) => {
    const key = keyForSlot(slot, category);
    criteria[key] = CATEGORIES[category].criteria;
    keyToCategory[key] = category;
  });
  return { criteria, keyToCategory };
}

function correctKey(ticket, keyForSlot) {
  const slot = ticket.slotOrder.indexOf(ticket.trueCategory);
  return keyForSlot(slot, ticket.trueCategory);
}

const SCHEMES = {
  neutral: {
    keyForSlot: (slot) => ["option_a", "option_b", "option_c"][slot],
  },
  descriptive: {
    keyForSlot: (_slot, category) => category,
  },
  loaded: {
    // correct slot -> "recommended"; the two wrong slots -> "unusual"/"risky" in slot order
    keyForSlot: (slot, category, ticket) =>
      category === ticket.trueCategory ? "recommended" : slot === (ticket.slotOrder.indexOf(ticket.trueCategory) + 1) % 3 ? "unusual" : "risky",
  },
  adversarial: {
    // correct slot -> "unlikely" (misleading); the slot right after it -> "recommended" (misleading); last -> "other"
    keyForSlot: (slot, category, ticket) => {
      const trueSlot = ticket.slotOrder.indexOf(ticket.trueCategory);
      if (category === ticket.trueCategory) return "unlikely";
      if (slot === (trueSlot + 1) % 3) return "recommended";
      return "other";
    },
  },
};

function buildRequestsForTicket(ticket) {
  const requests = [];
  for (const [schemeName, scheme] of Object.entries(SCHEMES)) {
    const keyForSlot = (slot, category) => scheme.keyForSlot(slot, category, ticket);
    const { criteria, keyToCategory } = buildCriteria(ticket, keyForSlot);
    requests.push({
      id: `${ticket.id}__${schemeName}`,
      condition: schemeName,
      scheme: schemeName,
      correctKeyInThisScheme: correctKey(ticket, keyForSlot),
      keyToCategory,
      state: ticket.state,
      questions: { route: choice("Which team should handle this support ticket?", criteria) },
    });
  }
  return requests;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!process.env.TYPESAFE_API_KEY) {
    throw new Error("TYPESAFE_API_KEY is not set");
  }

  const n = flags.limit != null ? Math.min(flags.limit, N_TICKETS) : N_TICKETS;
  const tickets = Array.from({ length: n }, (_, i) => buildTicket(i));
  const items = [];
  for (const ticket of tickets) {
    for (const req of buildRequestsForTicket(ticket)) items.push({ id: req.id, req });
  }

  console.log(
    `Label-bias run: tickets=${tickets.length} calls=${items.length}` +
      (flags.limit != null ? ` (--limit ${flags.limit})` : " (full sample)"),
  );

  const startedAt = new Date().toISOString();
  const { results, spentUsd, liveCalls } = await runExperiment({
    name: EXPERIMENT,
    items,
    buildRequest: (item) => item.req,
    flags,
  });
  const finishedAt = new Date().toISOString();

  console.log(`Done. newRecords=${results.length} liveCalls=${liveCalls} spentUsd=$${spentUsd.toFixed(4)}`);
  console.log(`startedAt=${startedAt} finishedAt=${finishedAt}`);
  console.log(`Next: node jev-label-bias/analyze.js`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
