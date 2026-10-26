import { describe, it, expect } from "vitest";
import {
  DEFAULT_TEMPLATES,
  LANGUAGES,
  MAX_TEMPLATE_LENGTH,
  PLACEHOLDERS,
  SAMPLE_VARS,
  TEMPLATE_KEYS,
  TEMPLATE_META,
  renderTemplate,
  unknownPlaceholders,
} from "../../src/utils/whatsappTemplates.js";

describe("renderTemplate", () => {
  it("fills placeholders and tolerates inner spaces", () => {
    expect(renderTemplate("Hi {{customer_name}} and {{ shop_name }}!", { customer_name: "Nimal", shop_name: "GearCo" })).toBe("Hi Nimal and GearCo!");
  });

  it("drops a line whose placeholders are all empty", () => {
    const out = renderTemplate("Hello {{customer_name}}\nCall us: {{shop_phone}}\nBye", { customer_name: "Nimal", shop_phone: "" });
    expect(out).toBe("Hello Nimal\nBye");
  });

  it("keeps a line when at least one placeholder has a value", () => {
    expect(renderTemplate("— {{shop_name}} {{shop_phone}}", { shop_name: "GearCo", shop_phone: "" })).toBe("— GearCo");
  });

  it("never prints 'undefined' or 'null' for missing variables", () => {
    const out = renderTemplate("A {{customer_name}} B {{total}}", { customer_name: undefined, total: null });
    expect(out).not.toMatch(/undefined|null/);
  });

  it("collapses runs of blank lines and trims", () => {
    expect(renderTemplate("\n\nA\n\n\n\nB\n\n", {})).toBe("A\n\nB");
    expect(renderTemplate("Total: {{total}}\n{{advance}}\n\nEnd", { total: "Rs. 1", advance: "" })).toBe("Total: Rs. 1\n\nEnd");
  });

  it("leaves plain text without placeholders untouched", () => {
    expect(renderTemplate("Plain text", {})).toBe("Plain text");
  });

  it("does not interpret regex or $ patterns in values", () => {
    expect(renderTemplate("{{items}}", { items: "$& $1 (x)" })).toBe("$& $1 (x)");
  });
});

describe("unknownPlaceholders", () => {
  it("lists only the unknown ones, once each", () => {
    expect(unknownPlaceholders("{{customer_name}} {{nope}} {{nope}} {{ also_bad }}").sort()).toEqual(["also_bad", "nope"]);
  });
  it("accepts every documented placeholder", () => {
    expect(unknownPlaceholders(PLACEHOLDERS.map((p) => `{{${p}}}`).join(" "))).toEqual([]);
  });
});

describe("built-in templates", () => {
  it("every message type has English and Sinhala wording", () => {
    for (const key of TEMPLATE_KEYS) {
      for (const lang of LANGUAGES) {
        expect(DEFAULT_TEMPLATES[key]?.[lang], `${key}/${lang}`).toBeTruthy();
      }
    }
    expect(Object.keys(DEFAULT_TEMPLATES).sort()).toEqual([...TEMPLATE_KEYS].sort());
  });

  it("use only known placeholders and fit the length limit", () => {
    for (const key of TEMPLATE_KEYS) {
      for (const lang of LANGUAGES) {
        const body = DEFAULT_TEMPLATES[key][lang];
        expect(unknownPlaceholders(body), `${key}/${lang}`).toEqual([]);
        expect(body.length).toBeLessThan(MAX_TEMPLATE_LENGTH);
      }
    }
  });

  it("English and Sinhala versions use the same placeholders", () => {
    const used = (b) => [...new Set([...b.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();
    for (const key of TEMPLATE_KEYS) {
      expect(used(DEFAULT_TEMPLATES[key].si), key).toEqual(used(DEFAULT_TEMPLATES[key].en));
    }
  });

  it("render cleanly with the sample data (no braces left, no 'undefined')", () => {
    for (const key of TEMPLATE_KEYS) {
      for (const lang of LANGUAGES) {
        const out = renderTemplate(DEFAULT_TEMPLATES[key][lang], SAMPLE_VARS[lang]);
        expect(out, `${key}/${lang}`).not.toMatch(/\{\{|undefined|null/);
        expect(out.length).toBeGreaterThan(5);
      }
    }
  });

  it("samples cover every placeholder in both languages", () => {
    for (const lang of LANGUAGES) for (const p of PLACEHOLDERS) expect(SAMPLE_VARS[lang][p], `${lang}.${p}`).toBeTruthy();
  });

  it("classifies each message type for the UI", () => {
    expect(TEMPLATE_META.custom.needsInvoice).toBe(false);
    for (const key of TEMPLATE_KEYS.filter((k) => k !== "custom")) expect(TEMPLATE_META[key].needsInvoice).toBe(true);
  });
});
