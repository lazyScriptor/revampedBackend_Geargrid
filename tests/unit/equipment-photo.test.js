import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const emitted = [];
vi.mock("../../src/sockets/emitters.js", () => ({
  emitToTenant: (...a) => emitted.push(["tenant", ...a]),
  emitToUser: (...a) => emitted.push(["user", ...a]),
}));
const device = { status: { paired: true, tenant_db_name: "geargrid_demo", operator: { user_id: 7 } } };
vi.mock("../../src/services/deviceService.js", () => ({ getDeviceStatus: async () => device.status }));
let tenantModels;
vi.mock("../../src/models/index.js", () => ({ initTenantModels: () => tenantModels }));
vi.mock("../../src/config/database.js", () => ({ getCachedTenantConnection: () => ({}) }));

const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(20)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);

let svc;
let tmp;
const cwd = process.cwd();

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gg-photo-"));
  process.chdir(tmp); // the service writes under ./uploads
  // equipmentImageRules reads its data relative to the source tree, not cwd
  svc = await import("../../src/services/equipmentPhotoService.js");
});
afterAll(() => {
  process.chdir(cwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const machine = (over = {}) => {
  const row = {
    equipment_id: 5,
    equipment_name: "Honda 10kVA Portable Generator",
    image_url: null,
    ...over,
    async update(p) {
      Object.assign(row, p);
      return row;
    },
  };
  return row;
};

const requestRow = (over = {}) => {
  const row = {
    token: "tok",
    status: "PENDING",
    equipment_id: 5,
    requested_by_user_id: 7,
    expires_at: new Date(Date.now() + 60_000),
    ...over,
    async update(p) {
      Object.assign(row, p);
      return row;
    },
  };
  return row;
};

const buildModels = ({ equipment = machine(), requests = [], phones = 1 } = {}) => ({
  Equipment: { findByPk: async (id) => (id === equipment.equipment_id ? equipment : null) },
  OperatorDevice: { count: async () => phones },
  PhotoRequest: {
    rows: requests,
    update: async (patch, { where }) => {
      requests.filter((r) => r.requested_by_user_id === where.requested_by_user_id && r.status === where.status).forEach((r) => Object.assign(r, patch));
    },
    create: async (data) => {
      const r = requestRow({ ...data });
      requests.push(r);
      return r;
    },
    findOne: async ({ where }) =>
      requests.find((r) => r.token === where.token && r.requested_by_user_id === where.requested_by_user_id) || null,
    findAll: async () => requests.filter((r) => r.status === "PENDING"),
  },
});

beforeEach(() => emitted.splice(0));

describe("photo file checks", () => {
  it("knows WebP, JPEG and PNG by their bytes, not their name", () => {
    expect(svc.detectImageType(WEBP)).toBe("webp");
    expect(svc.detectImageType(JPG)).toBe("jpg");
    expect(svc.detectImageType(PNG)).toBe("png");
    expect(svc.detectImageType(Buffer.from("<svg onload=alert(1)></svg>  "))).toBeNull();
  });

  it("refuses empty, oversized and non-image uploads with clear statuses", () => {
    expect(() => svc.validateImageBuffer(undefined)).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => svc.validateImageBuffer(Buffer.from("%PDF-1.7 hello world"))).toThrow(expect.objectContaining({ statusCode: 415 }));
    const huge = Buffer.concat([WEBP, Buffer.alloc(svc.MAX_IMAGE_BYTES)]);
    expect(() => svc.validateImageBuffer(huge)).toThrow(expect.objectContaining({ statusCode: 413 }));
  });
});

describe("saving a photo", () => {
  it("stores the file, points the machine at it and tells open screens", async () => {
    const equipment = machine();
    const out = await svc.saveEquipmentImage(buildModels({ equipment }), { tenantDbName: "geargrid_demo", equipmentId: 5, buffer: WEBP });
    expect(out.image_url).toMatch(/^\/uploads\/equipment\/geargrid_demo\/5-\d+-[0-9a-f]{6}\.webp$/);
    expect(equipment.image_url).toBe(out.image_url);
    expect(fs.existsSync(path.join(tmp, out.image_url))).toBe(true);
    expect(emitted).toContainEqual(["tenant", "geargrid_demo", "equipment:image-updated", { equipment_id: 5, image_url: out.image_url }]);
  });

  it("deletes the uploaded photo it replaces but never a stock photo", async () => {
    const equipment = machine();
    const models = buildModels({ equipment });
    const first = await svc.saveEquipmentImage(models, { tenantDbName: "geargrid_demo", equipmentId: 5, buffer: JPG });
    const second = await svc.saveEquipmentImage(models, { tenantDbName: "geargrid_demo", equipmentId: 5, buffer: WEBP });
    expect(fs.existsSync(path.join(tmp, first.image_url))).toBe(false);
    expect(fs.existsSync(path.join(tmp, second.image_url))).toBe(true);
  });

  it("404s for a machine that was deleted", async () => {
    await expect(svc.saveEquipmentImage(buildModels(), { tenantDbName: "t", equipmentId: 99, buffer: WEBP })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("reset with no stock photo for the type leaves the machine without a photo", async () => {
    const equipment = machine(); // generators have no stock photo
    const models = buildModels({ equipment });
    await svc.saveEquipmentImage(models, { tenantDbName: "geargrid_demo", equipmentId: 5, buffer: WEBP });
    expect((await svc.resetEquipmentImage(models, { tenantDbName: "geargrid_demo", equipmentId: 5 })).image_url).toBeNull();
  });

  it("reset goes back to the standard photo for the machine type", async () => {
    const equipment = machine({ equipment_name: "Air Compressor 50L" });
    const models = buildModels({ equipment });
    const saved = await svc.saveEquipmentImage(models, { tenantDbName: "geargrid_demo", equipmentId: 5, buffer: WEBP });
    const out = await svc.resetEquipmentImage(models, { tenantDbName: "geargrid_demo", equipmentId: 5 });
    expect(out.image_url).toMatch(/\/equipment\/air-compressor\.webp$/);
    expect(fs.existsSync(path.join(tmp, saved.image_url))).toBe(false);
  });
});

describe("phone photo requests", () => {
  it("needs a paired phone", async () => {
    await expect(svc.createPhotoRequest(buildModels({ phones: 0 }), { equipmentId: 5, userId: 7 })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("a new tap replaces the earlier open request", async () => {
    const requests = [];
    const models = buildModels({ requests });
    const a = await svc.createPhotoRequest(models, { equipmentId: 5, userId: 7 });
    const b = await svc.createPhotoRequest(models, { equipmentId: 5, userId: 7 });
    expect(requests.find((r) => r.token === a.token).status).toBe("CANCELLED");
    expect(b.status).toBe("PENDING");
  });

  it("phone upload saves the photo, closes the request and notifies the counter", async () => {
    const equipment = machine();
    const req = requestRow();
    tenantModels = buildModels({ equipment, requests: [req] });
    const out = await svc.submitPhotoFromDevice({}, "gg-phone", "tok", WEBP);
    expect(out.status).toBe("COMPLETED");
    expect(equipment.image_url).toBe(req.image_url);
    expect(emitted.find((e) => e[0] === "user")).toEqual(["user", "geargrid_demo", 7, "photo:captured", { token: "tok", equipment_id: 5, image_url: req.image_url }]);
  });

  it("refuses cancelled, expired and already-used requests", async () => {
    tenantModels = buildModels({ requests: [requestRow({ status: "CANCELLED" })] });
    await expect(svc.submitPhotoFromDevice({}, "d", "tok", WEBP)).rejects.toMatchObject({ statusCode: 410 });
    tenantModels = buildModels({ requests: [requestRow({ expires_at: new Date(Date.now() - 1000) })] });
    await expect(svc.submitPhotoFromDevice({}, "d", "tok", WEBP)).rejects.toMatchObject({ statusCode: 410 });
    tenantModels = buildModels({ requests: [requestRow({ status: "COMPLETED" })] });
    await expect(svc.submitPhotoFromDevice({}, "d", "tok", WEBP)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("another operator's phone cannot use the token", async () => {
    tenantModels = buildModels({ requests: [requestRow({ requested_by_user_id: 99 })] });
    await expect(svc.submitPhotoFromDevice({}, "d", "tok", WEBP)).rejects.toMatchObject({ statusCode: 404 });
  });
});
