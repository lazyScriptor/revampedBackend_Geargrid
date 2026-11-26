import { describe, it, expect } from "vitest";
import {
  createSavedFilter,
  deleteSavedFilter,
  listSavedFilters,
  MAX_SAVED_FILTERS,
  SAVED_FILTERS_KEY,
} from "../../src/services/activitySavedFiltersService.js";

// In-memory USER_UI_PREFERENCES with the model calls the service uses.
const makeModels = () => {
  const rows = new Map();
  return {
    rows,
    sequelize: { transaction: async (fn) => fn({}) },
    UserUiPreference: {
      findOne: async ({ where }) => rows.get(`${where.user_id}|${where.pref_key}`) ?? null,
      upsert: async (data) => {
        // MySQL may hand JSON back as a string; store it that way to exercise parseJsonField.
        rows.set(`${data.user_id}|${data.pref_key}`, { ...data, value: JSON.stringify(data.value) });
      },
    },
  };
};

describe("Activity saved views (GET/POST/DELETE /api/activity/saved-filters)", () => {
  it("saves, lists and deletes per user", async () => {
    const m = makeModels();
    const f = await createSavedFilter(m, 7, { name: " Discounts this week ", filters: { preset: "this_week", types: ["discount"] } });
    expect(f).toMatchObject({ name: "Discounts this week", filters: { preset: "this_week" } });
    expect(await listSavedFilters(m, 7)).toHaveLength(1);
    expect(await listSavedFilters(m, 8)).toEqual([]);
    expect(m.rows.has(`7|${SAVED_FILTERS_KEY}`)).toBe(true);
    await deleteSavedFilter(m, 7, f.id);
    expect(await listSavedFilters(m, 7)).toEqual([]);
  });

  it("refuses a nameless view, a missing view and more than the limit", async () => {
    const m = makeModels();
    await expect(createSavedFilter(m, 1, { name: "  ", filters: {} })).rejects.toMatchObject({ statusCode: 400 });
    await expect(deleteSavedFilter(m, 1, "nope")).rejects.toMatchObject({ statusCode: 404 });
    for (let i = 0; i < MAX_SAVED_FILTERS; i++) await createSavedFilter(m, 1, { name: `v${i}`, filters: {} });
    await expect(createSavedFilter(m, 1, { name: "one more", filters: {} })).rejects.toMatchObject({ statusCode: 409 });
  });
});
