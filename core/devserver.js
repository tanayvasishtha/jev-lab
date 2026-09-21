/** Tiny static file server for previewing pages locally. Not part of the harness. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || 4000;
const HOST = "127.0.0.1"; // never bind all interfaces; this tree includes .env

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".md": "text/plain",
  ".svg": "image/svg+xml",
};

// Anything matching these is refused outright, regardless of path traversal
// checks below; this is a static file server for a repo that keeps its own
// secrets (.env) and git history (.git) right next to the pages it serves.
const DENY_SEGMENTS = [".env", ".git", "node_modules"];

http
  .createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split("?")[0]);
    if (reqPath.endsWith("/")) reqPath += "index.html";
    const segments = reqPath.split(/[\\/]/).filter(Boolean);
    if (segments.some((s) => DENY_SEGMENTS.includes(s) || s.startsWith(".env"))) {
      res.writeHead(403);
      return res.end("forbidden");
    }

    const filePath = path.join(ROOT, reqPath);
    // Boundary-correct traversal check: a plain startsWith(ROOT) would let
    // "../jev-lab-evil" through, since that string also starts with "jev-lab".
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end("forbidden");
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("not found: " + reqPath);
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, HOST, () => console.log(`jev-lab preview on http://localhost:${PORT}`));
