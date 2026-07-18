/**
 * Zero-dependency static file server with SPA fallback.
 * Usage: node scripts/serve.mjs [dir=dist] [port=4173]
 * Used for local preview, e2e tests, prerendering and screenshot audits.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "dist");
const port = Number(process.argv[3] ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const pathname = decodeURIComponent(url.pathname);
    let filePath = normalize(join(dir, pathname));
    if (!filePath.startsWith(dir)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    if (!existsSync(filePath)) {
      // SPA fallback — serve the app shell for extension-less routes.
      if (!extname(pathname)) {
        filePath = join(dir, "index.html");
      } else {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
    }
    const ext = extname(filePath);
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(readFileSync(filePath));
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(port, () => {
  console.log(`serving ${dir} at http://localhost:${port}`);
});
