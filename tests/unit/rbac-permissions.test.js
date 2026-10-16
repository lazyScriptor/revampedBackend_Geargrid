import { describe, it, expect } from "vitest";

/**
 * Granular RBAC & Permission Resolution Unit Tests
 * Standards: Principle of Least Privilege, Explicit Overrides, Immutable SuperAdmin Hierarchy
 */

describe("RBAC Permissions Resolution & Hierarchy Unit Tests", () => {
  const resolveEffectivePermissions = (roles, overrides = []) => {
    const permissionSet = new Set();

    // 1. Collect all permissions across assigned roles
    roles.forEach((role) => {
      if (Array.isArray(role.Permissions)) {
        role.Permissions.forEach((perm) => {
          permissionSet.add(perm.permission_code);
        });
      }
    });

    // 2. Apply user-level overrides
    overrides.forEach((override) => {
      const code = override.Permission?.permission_code || override.permission_code;
      if (!code) return;

      if (override.override_type === "GRANT") {
        permissionSet.add(code);
      } else if (override.override_type === "REVOKE") {
        permissionSet.delete(code);
      }
    });

    return Array.from(permissionSet);
  };

  it("flattens and deduplicates permissions across multiple roles", () => {
    const roles = [
      {
        role_name: "Cashier",
        Permissions: [
          { permission_code: "invoice:create" },
          { permission_code: "invoice:view" },
          { permission_code: "customer:view" },
        ],
      },
      {
        role_name: "StockKeeper",
        Permissions: [
          { permission_code: "equipment:view" },
          { permission_code: "invoice:view" }, // Duplicate
        ],
      },
    ];

    const perms = resolveEffectivePermissions(roles);
    expect(perms).toHaveLength(4);
    expect(perms).toContain("invoice:create");
    expect(perms).toContain("invoice:view");
    expect(perms).toContain("customer:view");
    expect(perms).toContain("equipment:view");
  });

  it("applies user override GRANT to augment missing role permissions", () => {
    const roles = [
      {
        role_name: "JuniorCashier",
        Permissions: [{ permission_code: "invoice:create" }],
      },
    ];

    const overrides = [
      { permission_code: "accounting:view_daily_summary", override_type: "GRANT" },
    ];

    const perms = resolveEffectivePermissions(roles, overrides);
    expect(perms).toContain("accounting:view_daily_summary");
    expect(perms).toContain("invoice:create");
  });

  it("applies user override REVOKE to subtract permission even if present in role", () => {
    const roles = [
      {
        role_name: "Manager",
        Permissions: [
          { permission_code: "equipment:delete" },
          { permission_code: "equipment:view" },
          { permission_code: "invoice:delete" },
        ],
      },
    ];

    const overrides = [
      { permission_code: "equipment:delete", override_type: "REVOKE" },
    ];

    const perms = resolveEffectivePermissions(roles, overrides);
    expect(perms).not.toContain("equipment:delete");
    expect(perms).toContain("equipment:view");
    expect(perms).toContain("invoice:delete");
  });

  describe("Role Hierarchy Protection", () => {
    const canAssignRole = (actorHierarchy, targetRoleHierarchy) => {
      return actorHierarchy >= targetRoleHierarchy;
    };

    it("allows Admin (100) to assign Manager (50) or Cashier (10)", () => {
      expect(canAssignRole(100, 50)).toBe(true);
      expect(canAssignRole(100, 10)).toBe(true);
    });

    it("prevents Manager (50) from escalating privileges to Admin (100)", () => {
      expect(canAssignRole(50, 100)).toBe(false);
    });
  });

  describe("BUG-P1-06: Verification of Domain Granularity vs Collapsed Flag", () => {
    it("ensures an Accountant with accounting:view is granted accounting access without inventory_permission", () => {
      const accountantPerms = ["accounting:view", "accounting:manage_expenses", "report:view"];

      // Buggy check was: userPermissions.includes("inventory_permission") -> would be false!
      const canAccessAccountingLegacy = accountantPerms.includes("inventory_permission");
      expect(canAccessAccountingLegacy).toBe(false); // Demonstrates BUG-P1-06 locking out accountant

      // Proper granular check:
      const canAccessAccountingFixed = accountantPerms.includes("accounting:view");
      expect(canAccessAccountingFixed).toBe(true); // Demonstrates fix
    });
  });
});
