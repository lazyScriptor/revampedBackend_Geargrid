// @geargrid/contracts resolves via package.json file: dep against the vendored
// copy under revampedBackend_Geargrid/vendor/@geargrid/contracts/. The VM
// deploy's rsync + `npm install --omit=dev` installs it as a normal local
// dependency — no shared folder or workspace config is needed on the host.
// To update the vendored copy after editing shared/ sources, run
// `npm run contracts:release` from the GearGrid System repo root.

import AppError from "./AppError.js";

/**
 * registerContract — mount an Express route that is governed by a shared
 * @geargrid/contracts Contract definition.
 *
 *   registerContract(router, VaultToggleContract, {
 *     middlewares: [requirePermission("invoice:edit")],
 *     handler: async ({ params, req }) => invoiceService.toggleVaultStatus(...)
 *   });
 *
 * The adapter does three things for you:
 *   1. Validates `req.params`, `req.query` and `req.body` with the contract's
 *      Zod schemas (so the handler receives already-parsed, typed values).
 *   2. Wraps the handler's resolved value in the standard envelope
 *      `{ status: "success", data }` so controllers never hand-write it.
 *   3. Forwards any Zod validation error as a 400 AppError through the
 *      existing errorHandler middleware.
 *
 * The handler returns the inner `data` payload only (NOT the envelope).
 */
export function registerContract(router, contract, { basePath = "", middlewares = [], handler }) {
  const method = contract.method.toLowerCase();
  // Strip the router's mount prefix so the Express path matches `router.use` basis.
  // Example: contract.path="/invoices/:id/vault", basePath="/invoices" => "/:id/vault".
  const expressPath = basePath && contract.path.startsWith(basePath)
    ? contract.path.slice(basePath.length) || "/"
    : contract.path;

  router[method](expressPath, ...middlewares, async (req, res, next) => {
    try {
      const parsed = {
        params: contract.params ? safeParse(contract.params, req.params, "params") : req.params,
        query: contract.query ? safeParse(contract.query, req.query, "query") : req.query,
        body: contract.body ? safeParse(contract.body, req.body, "body") : req.body,
      };

      const data = await handler({ ...parsed, req, res });

      res.json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  });
}

function safeParse(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = [label, ...(first?.path ?? [])].join(".");
    throw new AppError(`Invalid ${path}: ${first?.message ?? "validation failed"}`, 400);
  }
  return result.data;
}
