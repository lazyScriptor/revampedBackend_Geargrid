/**
 * Public API for the Retail module.
 * All code outside `src/modules/retail/` MUST import only from this file.
 */

export * from "./money.js";
export { ensureWalkInCustomer } from "./walkInService.js";
export {
  DEFAULT_RETAIL_SETTINGS,
  DEFAULT_EXCEPTION_POLICIES,
  getRetailSettings,
  updateRetailSettings,
  mergeRetailSettings,
  validateRetailSettingsPatch,
} from "./retailSettingsService.js";
export { default as retailRoutes } from "./routes/retailRoutes.js";
export {
  COUNTER_EXCEPTION_TYPES,
  setMyApprovalPin,
  listApprovers,
  approveHere,
  requestRemoteApproval,
  decideApprovalRequest,
  recordCounterException,
  getApprovalDesk,
  consumeApprovalToken,
  hashContext,
  sha256Hex,
  clearRequesterFailureLimiter,
} from "./approvalService.js";
export { default as approvalRoutes } from "./routes/approvalRoutes.js";
export * from "./catalog/naming.js";
export { ensureStarterCatalog, loadStarterCatalogData } from "./catalog/starterService.js";
export * from "./catalog/catalogService.js";
export { searchFinder, browseFinder } from "./catalog/finderService.js";
export * from "./stock/stockService.js";
export * from "./sales/saleLinesService.js";
