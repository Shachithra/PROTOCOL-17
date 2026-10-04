import fs from "node:fs";

const src = fs.readFileSync("service-worker.js", "utf8");
let bad = 0;
for (const m of src.matchAll(/"(\.\/[^"]+)"/g)) {
  const p = m[1].slice(2);
  if (!p) continue;
  if (!fs.existsSync(p)) {
    console.log("SW missing:", m[1]);
    bad++;
  }
}
console.log("sw missing:", bad);
