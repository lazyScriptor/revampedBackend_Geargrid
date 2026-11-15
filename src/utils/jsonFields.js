/**
 * Safely parse a Sequelize JSON column that MySQL/MariaDB drivers sometimes
 * return as a JSON string instead of a parsed object.
 */
export const parseJsonField = (val, fallback = {}) => {
  if (val == null) return fallback;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }
  return val;
};
