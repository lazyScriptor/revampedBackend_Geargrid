import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve(import.meta.dirname, "../../src");
const RETAIL_DIR = path.join(SRC_DIR, "modules", "retail");
const RETAIL_INDEX = path.join(RETAIL_DIR, "index.js");

const FORBIDDEN_RENTAL_INTERNALS = [
  path.join(SRC_DIR, "services", "invoiceService.js"),
  path.join(SRC_DIR, "services", "accrualService.js"),
  path.join(SRC_DIR, "services", "invoiceDeletionService.js"),
  path.join(SRC_DIR, "services", "equipmentService.js"),
  path.join(SRC_DIR, "services", "defectService.js"),
  path.join(SRC_DIR, "utils", "rentalDays.js"),
];

const walkJsFiles = (dir) => {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJsFiles(full));
    } else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
};

const extractRelativeImports = (source) => {
  const specifiers = [];
  const staticImportRe = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportRe = /(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticImportRe, dynamicImportRe]) {
    let m;
    while ((m = re.exec(source)) !== null) {
      if (m[1].startsWith(".")) specifiers.push(m[1]);
    }
  }
  return specifiers;
};

describe("retail module boundaries", () => {
  const allFiles = walkJsFiles(SRC_DIR);

  it("outside files only import src/modules/retail/index.js", () => {
    const violations = [];
    for (const file of allFiles) {
      if (file.startsWith(RETAIL_DIR + path.sep)) continue;
      const content = fs.readFileSync(file, "utf8");
      for (const spec of extractRelativeImports(content)) {
        const resolved = path.resolve(path.dirname(file), spec);
        if (resolved.startsWith(RETAIL_DIR + path.sep) || resolved === RETAIL_DIR) {
          if (resolved !== RETAIL_INDEX) {
            violations.push(`${path.relative(SRC_DIR, file)} -> ${spec}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("retail module files never import rental internals", () => {
    const violations = [];
    for (const file of allFiles) {
      if (!file.startsWith(RETAIL_DIR + path.sep)) continue;
      const content = fs.readFileSync(file, "utf8");
      for (const spec of extractRelativeImports(content)) {
        const resolved = path.resolve(path.dirname(file), spec);
        if (FORBIDDEN_RENTAL_INTERNALS.includes(resolved)) {
          violations.push(`${path.relative(SRC_DIR, file)} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
