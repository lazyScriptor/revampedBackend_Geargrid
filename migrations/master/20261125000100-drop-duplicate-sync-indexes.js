import { dropDuplicateIndexes } from "../lib/duplicateIndexes.js";

// Remove the numbered index copies (`email_2` … `email_21`) that old `sequelize.sync({ alter: true })`
// runs left behind. On some databases they reach MySQL's 64-key limit, so startup sync fails with
// "Too many keys specified". Only exact copies of a kept `<base>` index are dropped; see the helper.

export const up = async ({ context: qi }) => {
  await dropDuplicateIndexes(qi);
};

// Nothing to restore: the dropped indexes were identical copies of indexes that remain.
export const down = async () => {};
