import { describe, it, expect, vi } from "vitest";
import { updateMyPreferences } from "../../src/services/meService.js";
import { START_PAGES, DEFAULT_START_PAGE } from "../../src/config/startPages.js";

// updateMyPreferences re-reads the profile afterwards; these tests only check what it writes, so
// the re-read is allowed to fail once the update call has been recorded.
const modelsSpy = () => ({ User: { update: vi.fn(async () => [1]), findOne: vi.fn(async () => null), findByPk: vi.fn(async () => null) } });
const save = async (models, payload) => {
  try {
    await updateMyPreferences(models, 7, payload);
  } catch (err) {
    if (err?.statusCode === 400) throw err;
  }
};

describe("start page preference", () => {
  it("defaults to Invoicing and offers it in the list", () => {
    expect(DEFAULT_START_PAGE).toBe("invoices");
    expect(START_PAGES).toEqual(expect.arrayContaining(["invoices", "customers", "equipment", "dashboard"]));
  });

  it("saves an allowed page", async () => {
    const models = modelsSpy();
    await save(models, { start_page: "customers" });
    expect(models.User.update).toHaveBeenCalledWith({ start_page: "customers" }, { where: { user_id: 7 } });
  });

  it("treats an empty choice as 'use the default'", async () => {
    const models = modelsSpy();
    await save(models, { start_page: "" });
    expect(models.User.update).toHaveBeenCalledWith({ start_page: null }, { where: { user_id: 7 } });
  });

  it("rejects a page that is not in the list, without saving", async () => {
    const models = modelsSpy();
    await expect(save(models, { start_page: "super-admin" })).rejects.toMatchObject({ statusCode: 400 });
    expect(models.User.update).not.toHaveBeenCalled();
  });
});
