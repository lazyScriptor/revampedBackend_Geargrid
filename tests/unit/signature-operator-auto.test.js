import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createSignatureRequest, submitSignature } from "../../src/services/signatureService.js";

vi.mock("../../src/sockets/emitters.js", () => ({ emitToUser: vi.fn(), emitToTenant: vi.fn() }));

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const TENANT = "vitest_operator_auto";
// The service resolves uploads/ against the backend root when it loads.
const UPLOADS = path.resolve(import.meta.dirname, "../../uploads");
const SAVED_URL = `/uploads/signatures/${TENANT}/operators/user-7.png`;

const buildModels = ({ operator }) => {
  const requests = [];
  const signatures = [];
  return {
    _signatures: signatures,
    Invoice: { findByPk: vi.fn(async (id) => (id === 42 ? { invoice_id: 42 } : null)) },
    TenantConfig: { findOne: vi.fn(async () => null) },
    User: {
      findByPk: vi.fn(async (id) =>
        id === operator.user_id
          ? { ...operator, update: vi.fn(async (patch) => Object.assign(operator, patch)) }
          : null,
      ),
    },
    SignatureRequest: {
      create: vi.fn(async (payload) => {
        const row = { request_id: requests.length + 1, ...payload, update: vi.fn(async (p) => Object.assign(row, p)) };
        requests.push(row);
        return row;
      }),
      findOne: vi.fn(async ({ where }) => requests.find((r) => r.token === where.token) || null),
    },
    InvoiceSignature: {
      findOne: vi.fn(async ({ where }) =>
        signatures.find((s) => s.signature_request_id === where.signature_request_id && s.signatory_role === where.signatory_role) || null,
      ),
      findAll: vi.fn(async ({ where }) => signatures.filter((s) => s.signature_request_id === where.signature_request_id)),
      create: vi.fn(async (payload) => {
        const row = { signature_id: signatures.length + 1, ...payload, update: vi.fn(async (p) => Object.assign(row, p)) };
        signatures.push(row);
        return row;
      }),
    },
  };
};

const user = { userId: 7, tenantDbName: TENANT };
const body = { checkpoint: "EQUIPMENT_DISPATCHED", required_roles: ["CUSTOMER", "OPERATOR"], expires_in_minutes: 10 };

describe("operator signature goes on automatically", () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(UPLOADS, "signatures", TENANT, "operators"), { recursive: true });
    await fs.writeFile(path.join(UPLOADS, SAVED_URL.replace("/uploads/", "")), Buffer.from(PNG_DATA_URL.split(",")[1], "base64"));
  });
  afterAll(async () => {
    await fs.rm(path.join(UPLOADS, "signatures", TENANT), { recursive: true, force: true });
  });

  it("signs for an operator with a saved signature as soon as the request is made, leaving only the customer", async () => {
    const models = buildModels({ operator: { user_id: 7, first_name: "Nimal", signature_url: SAVED_URL } });
    const result = await createSignatureRequest(models, user, 42, body);
    expect(result.auto_signed_roles).toEqual(["OPERATOR"]);
    expect(result.pending_roles).toEqual(["CUSTOMER"]);
    expect(result.status).toBe("PARTIAL");
    expect(models._signatures[0]).toMatchObject({ signatory_role: "OPERATOR", source: "STORED_OPERATOR_SIG", signatory_name: "Nimal" });
  });

  it("completes an operator-only request straight away", async () => {
    const models = buildModels({ operator: { user_id: 7, first_name: "Nimal", signature_url: SAVED_URL } });
    const result = await createSignatureRequest(models, user, 42, { ...body, required_roles: ["OPERATOR"] });
    expect(result.status).toBe("COMPLETED");
    expect(result.pending_roles).toEqual([]);
  });

  it("leaves the operator pending when there is no saved signature, and saves the first one they draw", async () => {
    const operator = { user_id: 7, first_name: "Nimal", signature_url: null };
    const models = buildModels({ operator });
    const result = await createSignatureRequest(models, user, 42, body);
    expect(result.auto_signed_roles).toEqual([]);
    expect(result.pending_roles).toEqual(["CUSTOMER", "OPERATOR"]);

    await submitSignature(
      models,
      result.token,
      { role: "OPERATOR", signatory_name: "Nimal", agreed_to_terms: true, terms_version: 1, image_data_url: PNG_DATA_URL },
      { tenantDbName: TENANT },
    );
    expect(operator.signature_url).toBe(SAVED_URL);
  });
});
