const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

const filePath = path.resolve(__dirname, "..", "public", "TEMPLATE TIENDEC.xlsx");
if (!fs.existsSync(filePath)) {
  console.error("No existe:", filePath);
  process.exit(1);
}

const wb = XLSX.readFile(filePath, { cellDates: true });
console.log("Sheets:", wb.SheetNames.join(", "));

const normalize = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws["!ref"];
  console.log("\n==", name, "==", ref || "(sin ref)");
  if (!ref) continue;

  const range = XLSX.utils.decode_range(ref);
  const maxRow = Math.min(range.e.r, 40);
  let best = { r: -1, score: 0, headers: [] };

  for (let r = range.s.r; r <= maxRow; r++) {
    const headers = [];
    for (let c = range.s.c; c <= Math.min(range.e.c, 80); c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      const v = cell ? String(cell.v).trim() : "";
      if (v) headers.push(v);
    }
    const score = headers.length;
    if (score > best.score) best = { r, score, headers };
  }

  console.log("bestHeaderRow(0based):", best.r, "count:", best.score);
  console.log("headers(raw):", best.headers.join(" | "));
  console.log("headers(norm):", best.headers.map(normalize).join(" | "));
}

