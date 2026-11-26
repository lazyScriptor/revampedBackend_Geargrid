// Saved filters on the Activity page ("My views"), one list per user.
// Stored in USER_UI_PREFERENCES (user_id + pref_key, JSON value) so no new table is needed.
import crypto from "crypto";
import AppError from "../utils/AppError.js";
import { parseJsonField } from "../utils/jsonFields.js";

export const SAVED_FILTERS_KEY = "activity.saved_filters";
export const MAX_SAVED_FILTERS = 20;

const readList = async (models, userId, transaction) => {
  const row = await models.UserUiPreference.findOne({
    where: { user_id: userId, pref_key: SAVED_FILTERS_KEY },
    transaction,
  });
  const list = parseJsonField(row?.value, []);
  return Array.isArray(list) ? list : [];
};

const writeList = (models, userId, list, transaction) =>
  models.UserUiPreference.upsert(
    { user_id: userId, pref_key: SAVED_FILTERS_KEY, value: list, updatedAt: new Date() },
    { transaction },
  );

export const listSavedFilters = async (models, userId) => readList(models, userId);

export const createSavedFilter = async (models, userId, { name, filters } = {}) => {
  const cleanName = String(name || "").trim().slice(0, 60);
  if (!cleanName) throw new AppError("Give the view a name.", 400);
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new AppError("Nothing to save: the filters are missing.", 400);
  }
  return models.sequelize.transaction(async (t) => {
    const list = await readList(models, userId, t);
    if (list.length >= MAX_SAVED_FILTERS) {
      throw new AppError(`You can keep up to ${MAX_SAVED_FILTERS} saved views. Delete one first.`, 409);
    }
    const filter = { id: crypto.randomUUID(), name: cleanName, filters };
    await writeList(models, userId, [...list, filter], t);
    return filter;
  });
};

export const deleteSavedFilter = async (models, userId, id) =>
  models.sequelize.transaction(async (t) => {
    const list = await readList(models, userId, t);
    const next = list.filter((f) => String(f?.id) !== String(id));
    if (next.length === list.length) throw new AppError("That saved view was not found.", 404);
    await writeList(models, userId, next, t);
    return { deleted: true };
  });
