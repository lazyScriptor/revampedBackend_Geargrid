// Each shop's subscription status, so protect() doesn't ask the master database on every request.
export const tenantStatusCache = new Map();
export const STATUS_CACHE_TTL = 5 * 60 * 1000;

/** A console change must apply to the shop's next request, not five minutes later. */
export const clearTenantStatusCache = () => tenantStatusCache.clear();
