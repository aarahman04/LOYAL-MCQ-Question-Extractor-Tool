#!/usr/bin/env node
/*
 * Zero-dependency static server for the extractor UI.
 * Serves the repo root so extractor-ui/index.html can load ../lib/core.js.
 *
 *   node scripts/serve-ui.js            -> http://localhost:5173/extractor-ui/
 *   PORT=8080 node scripts/serve-ui.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = process.env.PORT || 5173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/extractor-ui/index.html";
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.stat(filePath, (err, stat) => {
    let target = filePath;
    if (!err && stat.isDirectory()) target = path.join(filePath, "index.html");
    fs.readFile(target, (e, buf) => {
      if (e) {
        res.writeHead(404);
        return res.end("Not found: " + urlPath);
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(target)] || "application/octet-stream" });
      res.end(buf);
    });
  });
});

server.listen(PORT, () => {
  console.log(`\nExtractor UI  →  http://localhost:${PORT}/extractor-ui/\n(Ctrl+C to stop)\n`);
});
