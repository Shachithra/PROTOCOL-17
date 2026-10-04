import fs from "node:fs";
import path from "node:path";

const roots = [
  ...fs.readdirSync("js").map((f) => path.join("js", f)),
  ...fs.readdirSync("workers").map((f) => path.join("workers", f)),
  "index.html",
  "service-worker.js"
];

const re = /(?:from|import|src=|href=)\s*\(?\s*["']([^"'\n]+)["']/g;
let missing = 0;

for (const f of roots) {
  const src = fs.readFileSync(f, "utf8");
  let m;
  while ((m = re.exec(src))) {
    const t = m[1];
    if (/^(https?:|data:|#|mailto:)/.test(t)) continue;
    if (t.startsWith("/")) continue;
    const resolved = path.normalize(path.join(path.dirname(f), t.split("?")[0]));
    if (!fs.existsSync(resolved)) {
      console.log("MISSING", f, "->", t);
      missing++;
    }
  }
}
console.log("missing:", missing);
