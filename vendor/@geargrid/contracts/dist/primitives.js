import { z } from "zod";
// MySQL DECIMAL(12,2) is sometimes returned by sequelize/mysql2 as a string
// ("1234.50") and sometimes as a number. z.coerce.number() handles both.
export const Money = z.coerce.number().nonnegative();
export const PositiveInt = z.coerce.number().int().positive();
export const NonNegativeInt = z.coerce.number().int().nonnegative();
// The INVOICES.id_card_status column is TINYINT 0/1 on the DB side.
// 0 = ID released to client, 1 = ID retained in vault.
export const IdCardStatus = z.union([z.literal(0), z.literal(1)]);
// ISO 8601 datetime with timezone offset (e.g. "2026-10-19T06:40:00.000Z").
export const ISODate = z.string().min(1);
// ── Signature primitives ──────────────────────────────────────────────────
// A signature capture may be requested at any of these business checkpoints.
// Extendable: add new values here and regenerate contracts; both sides pick
// up the enum automatically.
export const SignatureCheckpoint = z.enum([
    "DEPOSIT_COLLECTED",
    "EQUIPMENT_DISPATCHED",
    "EQUIPMENT_RETURNED",
    "PAYMENT_RECEIVED",
    "OTHER",
]);
// Who the signature represents on the invoice.
export const SignatureRole = z.enum([
    "CUSTOMER",
    "OPERATOR",
    "GUARANTOR",
    "WITNESS",
]);
// How the signature image was produced.
export const SignatureSource = z.enum([
    "PHONE_CANVAS", // drawn on the mobile sign page
    "POS_CANVAS", // drawn directly on the POS screen (fallback)
    "STORED_OPERATOR_SIG", // operator attached their pre-saved signature
]);
// Lifecycle of a signature capture session.
export const SignatureStatus = z.enum([
    "PENDING", // created, no signatures captured yet
    "PARTIAL", // some but not all required_roles signed
    "COMPLETED", // all required_roles signed, session closed
    "EXPIRED", // TTL ran out before completion
    "CANCELLED", // operator cancelled before completion
]);
//# sourceMappingURL=primitives.js.map