import { z } from "zod";
import { successEnvelope } from "../envelope.js";
import { PositiveInt, Money, ISODate, SignatureCheckpoint, SignatureRole, SignatureSource, SignatureStatus, } from "../primitives.js";
// ─────────────────────────────────────────────────────────────────────────
// Signature capture subsystem
//
// Flow:
//   1. Operator (authenticated) calls CreateSignatureRequest -> gets { token, url }
//   2. POS shows a QR of the url (served by frontend at /sign/<token>)
//   3. Any phone scans -> hits GetSignatureSession (public, token-authed)
//   4. Phone submits one signature per required role via SubmitSignature (public)
//   5. Backend emits "signature:captured" + "signature:all-captured" via socket
//   6. Operator may cancel in-flight sessions via CancelSignatureRequest
//
// Operator convenience:
//   - SetOperatorSignature stores a reusable PNG against USERS so the operator
//     doesn't redraw on every bill. Public sign page can tap "Use my saved
//     signature" to apply it in one tap, no drawing required.
// ─────────────────────────────────────────────────────────────────────────
const InvoiceSummary = z.object({
    invoice_id: PositiveInt,
    invoice_number: z.string(),
    total_amount: Money,
    amount_paid: Money,
    deposit_held: Money,
    customer_name: z.string().nullable(),
});
const TenantBranding = z.object({
    business_display_name: z.string(),
    logo_url: z.string().nullable(),
    primary_color: z.string(),
    secondary_color: z.string(),
});
const RentalTerms = z.object({
    markdown: z.string(),
    version: z.number().int(),
});
const OperatorSavedSignature = z
    .object({
    operator_user_id: PositiveInt,
    operator_name: z.string(),
    has_saved_signature: z.boolean(),
})
    .nullable();
const CapturedSignatureSummary = z.object({
    role: SignatureRole,
    signatory_name: z.string(),
    captured_at: ISODate,
});
// ── CreateSignatureRequest ──────────────────────────────────────────────
// Operator triggers a signature capture session. Returns a token the POS
// turns into a QR for the phone(s) to scan.
export const CreateSignatureRequestContract = {
    path: "/invoices/:id/signature-requests",
    method: "POST",
    params: z.object({ id: PositiveInt }),
    body: z.object({
        checkpoint: SignatureCheckpoint,
        required_roles: z.array(SignatureRole).min(1).max(4),
        expires_in_minutes: z.number().int().min(1).max(60).default(10),
    }),
    response: successEnvelope(z.object({
        token: z.string(),
        sign_path: z.string(), // e.g. "/sign/abc123" — frontend prepends its origin
        checkpoint: SignatureCheckpoint,
        required_roles: z.array(SignatureRole),
        expires_at: ISODate,
    })),
};
// ── GetSignatureSession (PUBLIC, token-authed) ──────────────────────────
// The phone fetches this to render the sign page: invoice summary, tenant
// branding, terms, which roles still need to sign, and whether the operator's
// stored signature is available for one-tap application.
export const GetSignatureSessionContract = {
    path: "/signatures/public/:token",
    method: "GET",
    params: z.object({ token: z.string().min(10) }),
    response: successEnvelope(z.object({
        status: SignatureStatus,
        checkpoint: SignatureCheckpoint,
        invoice: InvoiceSummary,
        tenant: TenantBranding,
        terms: RentalTerms,
        required_roles: z.array(SignatureRole),
        captured_roles: z.array(CapturedSignatureSummary),
        pending_roles: z.array(SignatureRole),
        operator_saved_signature: OperatorSavedSignature,
        expires_at: ISODate,
    })),
};
// ── SubmitSignature (PUBLIC) ────────────────────────────────────────────
// One submission per role. Either provide image_data_url (drawn PNG) OR set
// use_stored_operator_signature=true (only valid for OPERATOR role AND only
// when the session's requesting-operator has a stored signature).
export const SubmitSignatureContract = {
    path: "/signatures/public/:token",
    method: "POST",
    params: z.object({ token: z.string().min(10) }),
    body: z
        .object({
        role: SignatureRole,
        signatory_name: z.string().min(1).max(150),
        agreed_to_terms: z.literal(true),
        terms_version: z.number().int(),
        use_stored_operator_signature: z.boolean().default(false),
        image_data_url: z.string().optional(),
    })
        .refine((v) => v.use_stored_operator_signature || !!v.image_data_url, "Either image_data_url or use_stored_operator_signature=true is required"),
    response: successEnvelope(z.object({
        signature_id: PositiveInt,
        role: SignatureRole,
        status: SignatureStatus,
        captured_roles: z.array(SignatureRole),
        pending_roles: z.array(SignatureRole),
        all_captured: z.boolean(),
    })),
};
// ── CancelSignatureRequest (auth) ───────────────────────────────────────
export const CancelSignatureRequestContract = {
    path: "/signatures/requests/:token",
    method: "DELETE",
    params: z.object({ token: z.string().min(10) }),
    response: successEnvelope(z.object({ cancelled: z.boolean() })),
};
// ── ListInvoiceSignatures (auth) ────────────────────────────────────────
// Captured signatures for an invoice, grouped by checkpoint. Used by the
// receipt renderer and the audit view.
export const ListInvoiceSignaturesContract = {
    path: "/invoices/:id/signatures",
    method: "GET",
    params: z.object({ id: PositiveInt }),
    response: successEnvelope(z.object({
        signatures: z.array(z.object({
            signature_id: PositiveInt,
            checkpoint: SignatureCheckpoint,
            role: SignatureRole,
            signatory_name: z.string(),
            signatory_user_id: PositiveInt.nullable(),
            image_url: z.string(),
            source: SignatureSource,
            captured_at: ISODate,
            terms_version_signed: z.number().int().nullable(),
        })),
    })),
};
// ── SetOperatorSignature (auth) ─────────────────────────────────────────
// Store or replace the authenticated operator's reusable signature.
export const SetOperatorSignatureContract = {
    path: "/me/signature",
    method: "POST",
    body: z.object({
        image_data_url: z.string().min(30), // base64 PNG; sanity minimum
    }),
    response: successEnvelope(z.object({
        signature_url: z.string(),
        captured_at: ISODate,
    })),
};
// ── DeleteOperatorSignature (auth) ──────────────────────────────────────
export const DeleteOperatorSignatureContract = {
    path: "/me/signature",
    method: "DELETE",
    response: successEnvelope(z.object({ deleted: z.boolean() })),
};
// ── GetRentalTerms (auth) + UpdateRentalTerms (admin) ───────────────────
export const GetRentalTermsContract = {
    path: "/config/rental-terms",
    method: "GET",
    response: successEnvelope(z.object({
        markdown: z.string(),
        version: z.number().int(),
        updated_at: ISODate.nullable(),
    })),
};
export const UpdateRentalTermsContract = {
    path: "/config/rental-terms",
    method: "PUT",
    body: z.object({
        markdown: z.string().min(1).max(50_000),
    }),
    response: successEnvelope(z.object({
        markdown: z.string(),
        version: z.number().int(),
        updated_at: ISODate,
    })),
};
//# sourceMappingURL=signatures.js.map