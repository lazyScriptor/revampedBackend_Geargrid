import { z } from "zod";
import { successEnvelope } from "../envelope.js";
import { PositiveInt, IdCardStatus } from "../primitives.js";
// PATCH /api/invoices/:id/vault
// Toggles the physical-ID-retained flag on an invoice. Returns the new state
// so the frontend's optimistic-update cache can confirm (or roll back).
export const VaultToggleData = z.object({
    is_id_retained_currently: z.boolean(),
    id_card_status: IdCardStatus,
});
export const VaultToggleContract = {
    path: "/invoices/:id/vault",
    method: "PATCH",
    params: z.object({ id: PositiveInt }),
    response: successEnvelope(VaultToggleData),
};
//# sourceMappingURL=invoices.js.map