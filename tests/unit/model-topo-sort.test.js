import { describe, it, expect } from "vitest";
import { Sequelize } from "sequelize";
import { initTenantModels } from "../../src/models/index.js";
import { initMasterModels } from "../../src/models/master/index.js";

describe("Model foreign-key topology (no cycles)", () => {
  it("tenant models can be topologically sorted without a foreign-key cycle", () => {
    const seq = new Sequelize("mysql://user:pass@localhost:3306/dummy_tenant", {
      logging: false,
    });
    initTenantModels(seq);
    const sorted = seq.modelManager.getModelsTopoSortedByForeignKey();
    expect(sorted).not.toBeNull();
    expect(Array.isArray(sorted)).toBe(true);
    expect(sorted.length).toBeGreaterThan(0);
  });

  it("master models can be topologically sorted without a foreign-key cycle", () => {
    const seq = new Sequelize("mysql://user:pass@localhost:3306/dummy_master", {
      logging: false,
    });
    initMasterModels(seq);
    const sorted = seq.modelManager.getModelsTopoSortedByForeignKey();
    expect(sorted).not.toBeNull();
    expect(Array.isArray(sorted)).toBe(true);
    expect(sorted.length).toBeGreaterThan(0);
  });
});
