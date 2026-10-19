import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSignatureRequest,
  getPublicSignatureSession,
  submitSignature,
  cancelSignatureRequest,
  getRentalTerms,
  updateRentalTerms,
} from "../../src/services/signatureService.js";

// Minimal 1x1 transparent PNG as a data URL — avoids writing real canvas art
// into tests while still passing the base64/sha256 pipeline end-to-end.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const buildMockModels = ({ invoice, tenantConfig, requester, existingRequest, existingSignatures = [] } = {}) => {
  const requestStore = existingRequest ? [existingRequest] : [];
  const signatureStore = [...existingSignatures];

  return {
    sequelize: { transaction: async (fn) => fn({}) },
    Invoice: {
      findByPk: vi.fn().mockImplementation(async (id) => {
        if (!invoice || invoice.invoice_id !== id) return null;
        return invoice;
      }),
    },
    TenantConfig: {
      findOne: vi.fn().mockResolvedValue(tenantConfig || null),
    },
    User: {
      findByPk: vi.fn().mockImplementation(async (id) => {
        if (!requester || requester.user_id !== id) return null;
        return {
          ...requester,
          update: vi.fn().mockImplementation(async (patch) => Object.assign(requester, patch)),
        };
      }),
    },
    SignatureRequest: {
      create: vi.fn().mockImplementation(async (payload) => {
        const row = {
          request_id: requestStore.length + 1,
          ...payload,
          update: vi.fn().mockImplementation(async (patch) => Object.assign(row, patch)),
        };
        requestStore.push(row);
        return row;
      }),
      findOne: vi.fn().mockImplementation(async ({ where }) => {
        const match = requestStore.find((r) => r.token === where.token);
        return match || null;
      }),
      update: vi.fn().mockResolvedValue([0]),
    },
    InvoiceSignature: {
      findOne: vi.fn().mockImplementation(async ({ where }) => {
        return (
          signatureStore.find(
            (s) =>
              s.signature_request_id === where.signature_request_id &&
              s.signatory_role === where.signatory_role,
          ) || null
        );
      }),
      findAll: vi.fn().mockImplementation(async ({ where }) =>
        signatureStore.filter((s) => s.signature_request_id === where.signature_request_id),
      ),
      create: vi.fn().mockImplementation(async (payload) => {
        const row = {
          signature_id: signatureStore.length + 1,
          ...payload,
          update: vi.fn().mockImplementation(async (patch) => Object.assign(row, patch)),
        };
        signatureStore.push(row);
        return row;
      }),
    },
    _requestStore: requestStore,
    _signatureStore: signatureStore,
  };
};

describe("Signature capture lifecycle", () => {
  let originalCwd;
  beforeEach(() => {
    originalCwd = process.cwd();
    // Point uploads at an OS temp dir so file writes don't pollute the repo.
    process.chdir("/tmp");
  });

  it("createSignatureRequest mints a token with the right required_roles & TTL", async () => {
    const invoice = { invoice_id: 42, total_amount: 1500 };
    const models = buildMockModels({ invoice });

    const result = await createSignatureRequest(
      models,
      { id: 7 },
      42,
      {
        checkpoint: "EQUIPMENT_DISPATCHED",
        required_roles: ["CUSTOMER", "OPERATOR"],
        expires_in_minutes: 10,
      },
    );

    expect(result.token).toBeTruthy();
    expect(result.token.length).toBeGreaterThanOrEqual(20);
    expect(result.sign_path).toBe(`/sign/${result.token}`);
    expect(result.checkpoint).toBe("EQUIPMENT_DISPATCHED");
    expect(result.required_roles).toEqual(["CUSTOMER", "OPERATOR"]);
    expect(new Date(result.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(models.SignatureRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_id: 42,
        requested_by_user_id: 7,
        status: "PENDING",
      }),
    );
  });

  it("getPublicSignatureSession returns tenant branding, pending roles, and operator saved-sig availability", async () => {
    const invoice = {
      invoice_id: 42,
      invoice_number: "INV-42",
      total_amount: 1500,
      advance_paid: 500,
      deposit_held: 300,
      Customer: { first_name: "Nimal", last_name: "Perera" },
    };
    const tenantConfig = {
      business_display_name: "ABC Rentals",
      logo_url: "/uploads/logos/abc.png",
      primary_color: "#ff6600",
      secondary_color: "#000000",
      rental_terms_markdown: "You take it, you bring it back.",
      rental_terms_version: 3,
    };
    const requester = {
      user_id: 7,
      first_name: "Jane",
      last_name: "Doe",
      username: "jane",
      signature_url: "/uploads/signatures/.../user-7.png",
    };
    const existingRequest = {
      request_id: 1,
      invoice_id: 42,
      checkpoint: "DEPOSIT_COLLECTED",
      required_roles: ["CUSTOMER", "OPERATOR"],
      token: "abc1234567890",
      requested_by_user_id: 7,
      status: "PENDING",
      expires_at: new Date(Date.now() + 60_000),
    };

    const models = buildMockModels({ invoice, tenantConfig, requester, existingRequest });

    const session = await getPublicSignatureSession(models, "abc1234567890");

    expect(session.status).toBe("PENDING");
    expect(session.checkpoint).toBe("DEPOSIT_COLLECTED");
    expect(session.invoice.invoice_number).toBe("INV-42");
    expect(session.invoice.customer_name).toBe("Nimal Perera");
    expect(session.tenant.business_display_name).toBe("ABC Rentals");
    expect(session.terms.version).toBe(3);
    expect(session.required_roles).toEqual(["CUSTOMER", "OPERATOR"]);
    expect(session.pending_roles).toEqual(["CUSTOMER", "OPERATOR"]);
    expect(session.operator_saved_signature).toEqual({
      operator_user_id: 7,
      operator_name: "Jane Doe",
      has_saved_signature: true,
    });
  });

  it("getPublicSignatureSession flips status to EXPIRED when TTL is in the past", async () => {
    const existingRequest = {
      request_id: 1,
      invoice_id: 42,
      checkpoint: "DEPOSIT_COLLECTED",
      required_roles: ["CUSTOMER"],
      token: "expired12345",
      requested_by_user_id: 7,
      status: "PENDING",
      expires_at: new Date(Date.now() - 1_000),
      update: null,
    };
    existingRequest.update = vi
      .fn()
      .mockImplementation(async (patch) => Object.assign(existingRequest, patch));

    const models = buildMockModels({
      invoice: { invoice_id: 42, total_amount: 1500 },
      tenantConfig: null,
      requester: null,
      existingRequest,
    });

    const session = await getPublicSignatureSession(models, "expired12345");

    expect(session.status).toBe("EXPIRED");
    expect(existingRequest.update).toHaveBeenCalledWith({ status: "EXPIRED" });
  });

  it("submitSignature rejects when the role is not required by the session", async () => {
    const existingRequest = {
      request_id: 1,
      invoice_id: 42,
      checkpoint: "DEPOSIT_COLLECTED",
      required_roles: ["CUSTOMER"],
      token: "goodtoken12345",
      requested_by_user_id: 7,
      status: "PENDING",
      expires_at: new Date(Date.now() + 60_000),
      update: vi.fn(),
    };

    const models = buildMockModels({
      invoice: { invoice_id: 42 },
      tenantConfig: null,
      requester: null,
      existingRequest,
    });

    await expect(
      submitSignature(
        models,
        "goodtoken12345",
        {
          role: "OPERATOR",
          signatory_name: "Mr. Operator",
          agreed_to_terms: true,
          terms_version: 1,
          image_data_url: PNG_DATA_URL,
        },
        { ip: "127.0.0.1", userAgent: "Mozilla", tenantDbName: "test" },
      ),
    ).rejects.toThrow(/not required/);
  });

  it("submitSignature flips status to COMPLETED only when every required role has signed", async () => {
    const existingRequest = {
      request_id: 1,
      invoice_id: 42,
      checkpoint: "DEPOSIT_COLLECTED",
      required_roles: ["CUSTOMER", "OPERATOR"],
      token: "multi1234567",
      requested_by_user_id: 7,
      status: "PENDING",
      expires_at: new Date(Date.now() + 60_000),
    };
    existingRequest.update = vi
      .fn()
      .mockImplementation(async (patch) => Object.assign(existingRequest, patch));

    const models = buildMockModels({
      invoice: { invoice_id: 42 },
      tenantConfig: null,
      requester: null,
      existingRequest,
    });

    // First signature — CUSTOMER. Expect status to transition to PARTIAL.
    const first = await submitSignature(
      models,
      "multi1234567",
      {
        role: "CUSTOMER",
        signatory_name: "Nimal",
        agreed_to_terms: true,
        terms_version: 1,
        image_data_url: PNG_DATA_URL,
      },
      { ip: "127.0.0.1", userAgent: "test", tenantDbName: "test" },
    );
    expect(first.status).toBe("PARTIAL");
    expect(first.all_captured).toBe(false);
    expect(first.pending_roles).toEqual(["OPERATOR"]);

    // Second — OPERATOR. Expect COMPLETED.
    const second = await submitSignature(
      models,
      "multi1234567",
      {
        role: "OPERATOR",
        signatory_name: "Jane",
        agreed_to_terms: true,
        terms_version: 1,
        image_data_url: PNG_DATA_URL,
      },
      { ip: "127.0.0.1", userAgent: "test", tenantDbName: "test" },
    );
    expect(second.status).toBe("COMPLETED");
    expect(second.all_captured).toBe(true);
    expect(second.pending_roles).toEqual([]);
  });

  it("submitSignature rejects a duplicate role on the same session", async () => {
    const existingRequest = {
      request_id: 1,
      invoice_id: 42,
      checkpoint: "DEPOSIT_COLLECTED",
      required_roles: ["CUSTOMER"],
      token: "dup123456789",
      requested_by_user_id: 7,
      status: "PENDING",
      expires_at: new Date(Date.now() + 60_000),
      update: vi.fn(),
    };

    const models = buildMockModels({
      invoice: { invoice_id: 42 },
      existingRequest,
      existingSignatures: [
        {
          signature_id: 1,
          signature_request_id: 1,
          signatory_role: "CUSTOMER",
        },
      ],
    });

    await expect(
      submitSignature(
        models,
        "dup123456789",
        {
          role: "CUSTOMER",
          signatory_name: "Nimal",
          agreed_to_terms: true,
          terms_version: 1,
          image_data_url: PNG_DATA_URL,
        },
        { ip: "127.0.0.1", userAgent: "test", tenantDbName: "test" },
      ),
    ).rejects.toThrow(/already signed/);
  });

  it("cancelSignatureRequest flips status to CANCELLED only on open sessions", async () => {
    const existingRequest = {
      request_id: 1,
      invoice_id: 42,
      status: "PENDING",
      token: "cancelme1234567",
      requested_by_user_id: 7,
    };
    existingRequest.update = vi
      .fn()
      .mockImplementation(async (patch) => Object.assign(existingRequest, patch));

    const models = buildMockModels({ existingRequest });

    const first = await cancelSignatureRequest(models, "cancelme1234567", { id: 7 }, { tenantDbName: "test" });
    expect(first.cancelled).toBe(true);

    // Second attempt should no-op because the row is now CANCELLED.
    const second = await cancelSignatureRequest(models, "cancelme1234567", { id: 7 }, { tenantDbName: "test" });
    expect(second.cancelled).toBe(false);
  });

  it("updateRentalTerms bumps the version and persists the markdown", async () => {
    const config = {
      rental_terms_markdown: "old terms",
      rental_terms_version: 2,
    };
    config.update = vi.fn().mockImplementation(async (patch) => Object.assign(config, patch));

    const models = {
      TenantConfig: { findOne: vi.fn().mockResolvedValue(config) },
    };

    const next = await updateRentalTerms(models, "brand new terms");

    expect(next.version).toBe(3);
    expect(next.markdown).toBe("brand new terms");
    expect(config.update).toHaveBeenCalledWith({
      rental_terms_markdown: "brand new terms",
      rental_terms_version: 3,
    });
  });

  it("getRentalTerms falls back to a default when no config row exists", async () => {
    const models = { TenantConfig: { findOne: vi.fn().mockResolvedValue(null) } };
    const result = await getRentalTerms(models);
    expect(result.version).toBe(1);
    expect(result.markdown).toMatch(/acknowledge/i);
  });
});
