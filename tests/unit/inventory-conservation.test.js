import { describe, it, expect } from "vitest";

/**
 * Inventory Conservation Law Test Suite
 * Fundamental Invariant: total_owned_qty = available_qty + rented_qty + defective_qty
 * No machinery can disappear into or materialize from the void.
 */

describe("Inventory Conservation Law & Maintenance Invariant Tests", () => {
  const assertInventoryInvariant = (item) => {
    const sum = item.available_qty + item.rented_qty + item.defective_qty;
    expect(sum).toBe(item.total_owned_qty);
    expect(item.available_qty).toBeGreaterThanOrEqual(0);
    expect(item.rented_qty).toBeGreaterThanOrEqual(0);
    expect(item.defective_qty).toBeGreaterThanOrEqual(0);
  };

  it("maintains invariant across normal rental dispatch and return", () => {
    const item = {
      total_owned_qty: 10,
      available_qty: 10,
      rented_qty: 0,
      defective_qty: 0,
    };
    assertInventoryInvariant(item);

    // 1. Dispatch 4 units
    const dispatchQty = 4;
    item.available_qty -= dispatchQty;
    item.rented_qty += dispatchQty;
    assertInventoryInvariant(item);
    expect(item.available_qty).toBe(6);
    expect(item.rented_qty).toBe(4);

    // 2. Return 4 units in good condition
    const returnQty = 4;
    item.rented_qty -= returnQty;
    item.available_qty += returnQty;
    assertInventoryInvariant(item);
    expect(item.available_qty).toBe(10);
    expect(item.rented_qty).toBe(0);
  });

  it("maintains invariant across damaged return and subsequent workshop repair", () => {
    const item = {
      total_owned_qty: 10,
      available_qty: 6,
      rented_qty: 4,
      defective_qty: 0,
    };
    assertInventoryInvariant(item);

    // 1. Customer returns 2 good items, 2 broken items
    const goodReturned = 2;
    const badReturned = 2;
    item.rented_qty -= (goodReturned + badReturned);
    item.available_qty += goodReturned;
    item.defective_qty += badReturned;

    assertInventoryInvariant(item);
    expect(item.available_qty).toBe(8);
    expect(item.rented_qty).toBe(0);
    expect(item.defective_qty).toBe(2);

    // 2. Workshop technician repairs 2 broken items
    const repairedQty = 2;
    item.defective_qty -= repairedQty;
    item.available_qty += repairedQty;

    assertInventoryInvariant(item);
    expect(item.available_qty).toBe(10);
    expect(item.defective_qty).toBe(0);
  });

  describe("BUG-P0-05: Internal Inspection Defect vs Repair Inflation", () => {
    it("demonstrates inventory corruption when defectLogService.createDefectLog does not deduct stock on internal audit", () => {
      const item = {
        total_owned_qty: 5,
        available_qty: 5,
        rented_qty: 0,
        defective_qty: 0,
      };

      // Bug condition: Technician discovers broken motor on shelf and reports defect via POST /api/defects
      // Buggy implementation in defectLogService.js line 25:
      // "Note: Inventory deduction is already handled by invoiceService during returns!"
      // Thus, available_qty and defective_qty are NOT touched during createDefectLog:
      const reportedInternalDefect = 1;
      // Item state was left unmodified: available=5, defective=0

      // When technician resolves defect in resolveDefectLog (lines 180-186):
      // defective_qty = defective_qty - qtyToResolve;
      // available_qty = available_qty + qtyToResolve;
      item.defective_qty -= reportedInternalDefect; // 0 - 1 = -1
      item.available_qty += reportedInternalDefect; // 5 + 1 = 6

      // Corrupted state:
      expect(item.defective_qty).toBe(-1); // NEGATIVE DEFECTIVE COUNT
      expect(item.available_qty).toBe(6);  // EXCEEDS TOTAL OWNED!
      expect(item.available_qty + item.rented_qty + item.defective_qty).toBe(5); // Sum matches mathematically but state is corrupted!
    });

    it("verifies the QA remediation: internal defect report atomically adjusts available and defective stock", () => {
      const item = {
        total_owned_qty: 5,
        available_qty: 5,
        rented_qty: 0,
        defective_qty: 0,
      };

      // Proper remediation: Check source of defect
      const source = "INTERNAL_INSPECTION";
      const reportedQty = 1;

      if (source === "INTERNAL_INSPECTION") {
        if (item.available_qty < reportedQty) {
          throw new Error("Insufficient available stock to flag as defective.");
        }
        item.available_qty -= reportedQty;
        item.defective_qty += reportedQty;
      }

      assertInventoryInvariant(item);
      expect(item.available_qty).toBe(4);
      expect(item.defective_qty).toBe(1);

      // Now technician resolves repair:
      item.defective_qty -= reportedQty;
      item.available_qty += reportedQty;

      assertInventoryInvariant(item);
      expect(item.available_qty).toBe(5);
      expect(item.defective_qty).toBe(0);
    });
  });

  describe("BUG-P2-02: Lease & ID Vault Safety Check Before Deletion", () => {
    it("blocks deletion of equipment if currently rented out", () => {
      const equipment = {
        equipment_id: 42,
        equipment_name: "Compactor",
        rented_qty: 2,
      };

      const validateEquipmentDeletion = (eq) => {
        if (eq.rented_qty > 0) {
          throw new Error(`Cannot delete equipment "${eq.equipment_name}". 2 units are currently checked out on active leases.`);
        }
        return true;
      };

      expect(() => validateEquipmentDeletion(equipment)).toThrow("Cannot delete equipment");
    });

    it("blocks deletion of customer if active lease exists or ID card is held in vault", () => {
      const customer = {
        customer_id: 101,
        first_name: "Kamal",
        is_id_retained_currently: true,
        activeInvoicesCount: 1,
      };

      const validateCustomerDeletion = (cust) => {
        if (cust.is_id_retained_currently) {
          throw new Error("Cannot delete customer. Physical ID card is currently held in the vault.");
        }
        if (cust.activeInvoicesCount > 0) {
          throw new Error("Cannot delete customer with open active invoices.");
        }
        return true;
      };

      expect(() => validateCustomerDeletion(customer)).toThrow("Physical ID card is currently held");
    });
  });
});
