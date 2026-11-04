import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ globals: [], codes: [], tenantUser: null, mails: [] }));
vi.mock("../../src/models/master/index.js", () => ({
  getMasterModels: () => ({
    GlobalUser: {
      findOne: async ({ where }) => {
        const g = db.globals.find((u) => (where.email ? u.email === where.email : u.username === where.username));
        return g ? { ...g, update: async (p) => Object.assign(g, p) } : null;
      },
    },
    Tenant: { findByPk: async () => ({ db_name: "shop" }) },
    PasswordResetCode: {
      count: async () => db.codes.filter((c) => c.channel === "email").length,
      create: async (v) => db.codes.push({ used_at: null, attempts: 0, ...v }),
      update: async (p, { where }) => db.codes.filter((c) => c.global_user_id === where.global_user_id && !c.used_at).forEach((c) => Object.assign(c, p)),
      findOne: async ({ where }) => {
        const c = [...db.codes].reverse().find((x) => x.global_user_id === where.global_user_id && !x.used_at && x.expires_at > new Date());
        return c ? { ...c, update: async (p) => Object.assign(c, p) } : null;
      },
    },
  }),
}));
vi.mock("../../src/config/database.js", () => ({ getTenantConnection: async () => ({}), masterSequelize: {}, getCachedTenantConnection: () => ({}) }));
vi.mock("../../src/models/index.js", () => ({
  initTenantModels: () => ({ User: { findOne: async () => db.tenantUser } }),
}));
vi.mock("../../src/services/emailService.js", () => ({
  sendResetCodeEmail: vi.fn(async (m) => { db.mails.push(m); return { sent: true }; }),
  sendPasswordChangedEmail: vi.fn(async () => ({ sent: true })),
}));

import { findGlobalUser, issueAdminResetCode, requestResetCode, resetPasswordWithCode } from "../../src/services/passwordResetService.js";
import { getUserForAdminReset } from "../../src/services/userService.js";

beforeEach(() => {
  process.env.JWT_SECRET = "test";
  db.globals = [{ global_user_id: 1, email: "a@b.lk", username: "kasun", password_hash: "old" }];
  db.codes = [];
  db.mails = [];
  db.tenantUser = { update: vi.fn(async () => {}) };
});
const sentCode = () => db.mails.at(-1).code;

describe("finding a login", () => {
  it("email or username, not either against both", async () => {
    expect((await findGlobalUser("a@b.lk")).username).toBe("kasun");
    expect((await findGlobalUser(" kasun ")).email).toBe("a@b.lk");
    expect(await findGlobalUser("nobody")).toBeNull();
    expect(await findGlobalUser("")).toBeNull();
  });
});

describe("asking for a code", () => {
  it("emails a 6-digit code, and stores only a hash of it", async () => {
    await requestResetCode("kasun");
    expect(db.mails[0].to).toBe("a@b.lk");
    expect(sentCode()).toMatch(/^\d{6}$/);
    expect(db.codes[0].code_hash).not.toContain(sentCode());
  });
  it("an unknown account sends nothing and doesn't complain", async () => {
    await expect(requestResetCode("nobody")).resolves.toBeUndefined();
    expect(db.mails).toHaveLength(0);
  });
  it("stops after 3 in the window", async () => {
    for (let i = 0; i < 5; i++) await requestResetCode("kasun");
    expect(db.mails).toHaveLength(3);
  });
  it("only the newest code works", async () => {
    await requestResetCode("kasun");
    const first = sentCode();
    await requestResetCode("kasun");
    if (first !== sentCode()) await expect(resetPasswordWithCode({ identifier: "kasun", code: first, newPassword: "newpassword" })).rejects.toThrow(/wrong or has expired/);
    await expect(resetPasswordWithCode({ identifier: "kasun", code: sentCode(), newPassword: "newpassword" })).resolves.toBeUndefined();
  });
});

describe("using a code", () => {
  it("changes both password records and clears the forced change", async () => {
    await requestResetCode("a@b.lk");
    await resetPasswordWithCode({ identifier: "a@b.lk", code: sentCode(), newPassword: "newpassword" });
    expect(db.globals[0].password_hash).not.toBe("old");
    const sent = db.tenantUser.update.mock.calls[0][0];
    expect(sent.password_hash).toBe(db.globals[0].password_hash);
    expect(sent.must_change_password).toBe(false);
  });
  it("works once", async () => {
    await requestResetCode("kasun");
    const code = sentCode();
    await resetPasswordWithCode({ identifier: "kasun", code, newPassword: "newpassword" });
    await expect(resetPasswordWithCode({ identifier: "kasun", code, newPassword: "another-one" })).rejects.toMatchObject({ statusCode: 400 });
  });
  it("dies after 5 wrong tries, even with the right code after", async () => {
    await requestResetCode("kasun");
    const code = sentCode();
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) await expect(resetPasswordWithCode({ identifier: "kasun", code: wrong, newPassword: "newpassword" })).rejects.toThrow();
    await expect(resetPasswordWithCode({ identifier: "kasun", code, newPassword: "newpassword" })).rejects.toThrow();
    expect(db.globals[0].password_hash).toBe("old");
  });
  it("an expired code fails", async () => {
    await requestResetCode("kasun");
    db.codes[0].expires_at = new Date(Date.now() - 1000);
    await expect(resetPasswordWithCode({ identifier: "kasun", code: sentCode(), newPassword: "newpassword" })).rejects.toThrow(/expired/);
  });
  it("a short password is refused and doesn't use up the code", async () => {
    await requestResetCode("kasun");
    await expect(resetPasswordWithCode({ identifier: "kasun", code: sentCode(), newPassword: "short" })).rejects.toThrow(/8 characters/);
    expect(db.codes[0].attempts).toBe(0);
  });
  it("a deactivated user can't use one", async () => {
    await requestResetCode("kasun");
    db.tenantUser = null;
    await expect(resetPasswordWithCode({ identifier: "kasun", code: sentCode(), newPassword: "newpassword" })).rejects.toThrow();
    expect(db.globals[0].password_hash).toBe("old");
  });
  it("an unknown account gets the same answer as a wrong code", async () => {
    await expect(resetPasswordWithCode({ identifier: "nobody", code: "123456", newPassword: "newpassword" })).rejects.toThrow(/wrong or has expired/);
  });
});

describe("codes from an admin", () => {
  const models = (over = {}) => ({
    Role: {},
    User: { findByPk: async () => ({ user_id: 5, email: "a@b.lk", is_active: true, Roles: [{ hierarchy_level: 20 }], ...over }) },
  });
  it("gives the admin a working code", async () => {
    const { code, minutes } = await issueAdminResetCode("a@b.lk");
    expect(minutes).toBe(30);
    await expect(resetPasswordWithCode({ identifier: "kasun", code, newPassword: "newpassword" })).resolves.toBeUndefined();
  });
  it("never for someone above you, so a manager can't take over an owner", async () => {
    await expect(getUserForAdminReset(models({ Roles: [{ hierarchy_level: 100 }] }), 5, { userId: 9, roleHierarchyLevel: 50 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(getUserForAdminReset(models(), 5, { userId: 9, roleHierarchyLevel: 50 })).resolves.toBeTruthy();
  });
  it("not for yourself or a deactivated user", async () => {
    await expect(getUserForAdminReset(models(), 5, { userId: 5, roleHierarchyLevel: 100 })).rejects.toThrow(/your own/);
    await expect(getUserForAdminReset(models({ is_active: false }), 5, { userId: 9, roleHierarchyLevel: 100 })).rejects.toThrow(/deactivated/);
  });
});
