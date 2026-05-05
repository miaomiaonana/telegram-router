import fs from "node:fs";

function normalizeSymbol(symbol) {
  return symbol
    .trim()
    .replace(/^\$/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export class WatchlistStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  list() {
    if (!fs.existsSync(this.filePath)) return [];

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return Array.isArray(parsed.symbols) ? parsed.symbols : [];
    } catch {
      return [];
    }
  }

  add(symbol) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return { symbol: "", changed: false };

    const symbols = this.list();
    if (!symbols.includes(normalized)) {
      symbols.push(normalized);
      this.save(symbols);
      return { symbol: normalized, changed: true };
    }

    return { symbol: normalized, changed: false };
  }

  remove(symbol) {
    const normalized = normalizeSymbol(symbol);
    const symbols = this.list();
    const next = symbols.filter((item) => item !== normalized);

    if (next.length !== symbols.length) {
      this.save(next);
      return { symbol: normalized, changed: true };
    }

    return { symbol: normalized, changed: false };
  }

  save(symbols) {
    fs.writeFileSync(
      this.filePath,
      JSON.stringify({ symbols: [...new Set(symbols)].sort() }, null, 2),
    );
  }
}

export { normalizeSymbol };
