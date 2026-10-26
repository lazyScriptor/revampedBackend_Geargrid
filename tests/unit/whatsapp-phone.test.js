import { describe, it, expect } from "vitest";
import { normalizePhone, pickWhatsAppNumber, buildWaLink } from "../../src/utils/whatsappPhone.js";

describe("normalizePhone — Sri Lankan mobiles typed every which way", () => {
  it.each([
    ["0771234567"],
    ["077 123 4567"],
    ["077-123-4567"],
    ["(077) 123 4567"],
    ["+94771234567"],
    ["+94 77 123 4567"],
    ["94771234567"],
    ["0094771234567"],
    ["771234567"],
    ["+94 (0) 77 123 4567"],
    ["  0771234567  "],
  ])("%s → 94771234567", (raw) => {
    const r = normalizePhone(raw);
    expect(r.digits).toBe("94771234567");
    expect(r.kind).toBe("mobile");
    expect(r.valid).toBe(true);
    expect(r.display).toBe("+94 77 123 4567");
  });

  it.each(["070", "071", "072", "074", "075", "076", "077", "078"])("accepts the %s mobile range", (p) => {
    expect(normalizePhone(`${p}1234567`).valid).toBe(true);
  });

  it("flags landlines as unable to take WhatsApp but keeps the digits", () => {
    const r = normalizePhone("011 234 5678");
    expect(r).toMatchObject({ digits: "94112345678", kind: "landline", valid: false });
    expect(normalizePhone("+94 11 2345678").kind).toBe("landline");
  });

  it("accepts a plausible foreign number only with a + or 00 prefix", () => {
    expect(normalizePhone("+44 20 7946 0958")).toMatchObject({ digits: "442079460958", kind: "international", valid: true, display: "+442079460958" });
    expect(normalizePhone("0044 20 7946 0958").valid).toBe(true);
    expect(normalizePhone("+1 (555) 010-9999").digits).toBe("15550109999");
  });

  it.each([[""], ["   "], [null], [undefined], ["abc"], ["12345"], ["+123"], ["07712345"], ["0771234567890"]])("rejects %j", (raw) => {
    const r = normalizePhone(raw);
    expect(r.valid).toBe(false);
    expect(r.kind === "invalid" || r.kind === "landline").toBe(true);
  });
});

describe("pickWhatsAppNumber — fields holding several numbers", () => {
  it("prefers the first number that can take WhatsApp", () => {
    expect(pickWhatsAppNumber("011 2345678 / 077 123 4567").digits).toBe("94771234567");
    expect(pickWhatsAppNumber("0112345678, 0712345678").digits).toBe("94712345678");
    expect(pickWhatsAppNumber("077 111 2222 and 071 333 4444").digits).toBe("94771112222");
    expect(pickWhatsAppNumber("0771112222;0713334444").digits).toBe("94771112222");
  });

  it("falls back to the first parseable number so the UI can explain the problem", () => {
    const r = pickWhatsAppNumber("011 2345678");
    expect(r.digits).toBe("94112345678");
    expect(r.valid).toBe(false);
    expect(r.kind).toBe("landline");
  });

  it("handles empty and junk", () => {
    expect(pickWhatsAppNumber("").valid).toBe(false);
    expect(pickWhatsAppNumber(null).valid).toBe(false);
    expect(pickWhatsAppNumber("n/a").valid).toBe(false);
  });
});

describe("buildWaLink", () => {
  it("builds a wa.me link with the text percent-encoded", () => {
    const link = buildWaLink("94771234567", "Hello & thanks!\nLine 2 — 50% #1");
    expect(link.startsWith("https://wa.me/94771234567?text=")).toBe(true);
    const text = decodeURIComponent(link.split("?text=")[1]);
    expect(text).toBe("Hello & thanks!\nLine 2 — 50% #1");
    expect(link).toContain("%0A"); // newlines survive
    expect(link).not.toMatch(/[ \n]/);
  });

  it("round-trips Sinhala text", () => {
    const si = "ඉන්වොයිසිය INV-5 සඳහා ස්තූතියි";
    expect(decodeURIComponent(buildWaLink("94771234567", si).split("?text=")[1])).toBe(si);
  });

  it("opens the contact picker when there is no number, and omits ?text for empty text", () => {
    expect(buildWaLink("", "hi")).toBe("https://wa.me/?text=hi");
    expect(buildWaLink("94771234567")).toBe("https://wa.me/94771234567");
  });
});
