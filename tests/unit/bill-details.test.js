import { describe, expect, it } from "vitest";
import { getBillDetails, updateBillDetails } from "../../src/services/tenantConfigService.js";

const fakeModels = (initial) => {
  let row = initial
    ? {
        ...initial,
        async update(patch) {
          Object.assign(row, patch);
          return row;
        },
      }
    : null;
  return {
    TenantConfig: {
      findOne: async () => row,
      create: async (data) => {
        row = { ...data, custom_settings: null, async update(p) { Object.assign(row, p); return row; } };
        return row;
      },
    },
    get row() {
      return row;
    },
  };
};

describe("bill details", () => {
  it("reads empty strings when nothing is saved", async () => {
    expect(await getBillDetails(fakeModels({ custom_settings: null }))).toEqual({ phone: "", address: "", email: "" });
  });

  it("merges into custom_settings without touching other settings (WhatsApp etc.)", async () => {
    const models = fakeModels({ custom_settings: JSON.stringify({ whatsapp: { default_language: "si" }, phone: "011" }) });
    const out = await updateBillDetails(models, { phone: " 0777593701 ", address: "23 New Galle Road, Moratuwa" });
    expect(out).toEqual({ phone: "0777593701", address: "23 New Galle Road, Moratuwa", email: "" });
    expect(models.row.custom_settings.whatsapp).toEqual({ default_language: "si" });
  });

  it("leaves fields that were not sent alone, and clears a field sent empty", async () => {
    const models = fakeModels({ custom_settings: { phone: "0777593701", email: "a@b.lk" } });
    await updateBillDetails(models, { email: "" });
    expect(await getBillDetails(models)).toEqual({ phone: "0777593701", address: "", email: "" });
  });

  it("rejects bad email and over-long values", async () => {
    const models = fakeModels({ custom_settings: {} });
    await expect(updateBillDetails(models, { email: "not-an-email" })).rejects.toThrow(/not valid/);
    await expect(updateBillDetails(models, { phone: "1".repeat(31) })).rejects.toThrow(/too long/);
  });

  it("creates the config row when the tenant has none", async () => {
    const models = fakeModels(null);
    expect(await updateBillDetails(models, { phone: "0777593701" })).toMatchObject({ phone: "0777593701" });
  });
});
