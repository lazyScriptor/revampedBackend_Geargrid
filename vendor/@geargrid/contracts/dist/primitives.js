import { z } from "zod";
// MySQL DECIMAL(12,2) is sometimes returned by sequelize/mysql2 as a string
// ("1234.50") and sometimes as a number. z.coerce.number() handles both.
export const Money = z.coerce.number().nonnegative();
export const PositiveInt = z.coerce.number().int().positive();
export const NonNegativeInt = z.coerce.number().int().nonnegative();
// The INVOICES.id_card_status column is TINYINT 0/1 on the DB side.
// 0 = ID released to client, 1 = ID retained in vault.
export const IdCardStatus = z.union([z.literal(0), z.literal(1)]);
//# sourceMappingURL=primitives.js.map