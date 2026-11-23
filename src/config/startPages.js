// Pages a user may choose to open after signing in (Profile → Preferences → Start page).
// The web app shows only the ones the user's role can open; an empty choice means Invoicing.
export const START_PAGES = [
  "invoices",
  "customers",
  "equipment",
  "dashboard",
  "rental-history",
  "accounting",
  "reports",
  "maintenance",
  "messages",
  "locker",
  // Retail shops: the Stock workspace (the web app shows it only when retail is on).
  "stock",
];

export const DEFAULT_START_PAGE = "invoices";
