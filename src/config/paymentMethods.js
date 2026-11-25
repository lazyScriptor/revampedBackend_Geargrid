/**
 * Canonical payment methods aligned with the frontend POS & accounting UI.
 * Legacy "Transfer" values map to "Bank Transfer".
 */

export const PAYMENT_METHODS = [
  "Cash",
  "Card",
  "Bank Transfer",
  "Cheque",
  "Online",
  "WalletDeposit",
];

const ALIASES = new Map([
  ["cash", "Cash"],
  ["card", "Card"],
  ["bank transfer", "Bank Transfer"],
  ["transfer", "Bank Transfer"],
  ["bank_transfer", "Bank Transfer"],
  ["cheque", "Cheque"],
  ["online", "Online"],
  ["walletdeposit", "WalletDeposit"],
  ["wallet deposit", "WalletDeposit"],
  ["wallet_deposit", "WalletDeposit"],
]);

export const normalizePaymentMethod = (method) => {
  const key = String(method || "").trim().toLowerCase();
  return ALIASES.get(key) || String(method || "").trim();
};

export const isCash = (method) =>
  String(method || "").trim().toLowerCase() === "cash";
