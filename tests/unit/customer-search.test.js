import { describe, it, expect, vi } from "vitest";
import { inspect } from "node:util";
import { Op } from "sequelize";
import {
  phoneSearchCore,
  isWholeNumber,
  findCustomerIdsBySearch,
  customerSearchOrder,
  idsForSqlIn,
} from "../../src/utils/customerSearch.js";
import { getAllCustomers } from "../../src/services/customerService.js";
import { searchPhoneContacts } from "../../src/services/phoneContactService.js";

describe("phoneSearchCore", () => {
  it("drops the local 0 and the 94 / 0094 country prefix so every form matches", () => {
    expect(phoneSearchCore("0771234567")).toBe("771234567");
    expect(phoneSearchCore("+94 77 123 4567")).toBe("771234567");
    expect(phoneSearchCore("94771234567")).toBe("771234567");
    expect(phoneSearchCore("0094771234567")).toBe("771234567");
    expect(phoneSearchCore("077-123")).toBe("77123");
  });

  it("refuses names and too-short numbers", () => {
    expect(phoneSearchCore("Kamal Perera")).toBeNull();
    expect(phoneSearchCore("Kamal 07")).toBeNull();
    expect(phoneSearchCore("077")).toBeNull();
    expect(phoneSearchCore("")).toBeNull();
    expect(phoneSearchCore(undefined)).toBeNull();
  });

  it("recognises whole numbers", () => {
    expect(isWholeNumber(" 104 ")).toBe(true);
    expect(isWholeNumber("INV-104")).toBe(false);
  });

  it("never sends an empty IN () list to raw SQL", () => {
    expect(idsForSqlIn([])).toEqual([-1]);
    expect(idsForSqlIn([3, 4])).toEqual([3, 4]);
  });
});

describe("findCustomerIdsBySearch", () => {
  it("returns [] without querying for an empty or 1-letter term", async () => {
    const findAll = vi.fn();
    expect(await findCustomerIdsBySearch({ Customer: { findAll } }, "")).toEqual([]);
    expect(await findCustomerIdsBySearch({ Customer: { findAll } }, "   ")).toEqual([]);
    expect(await findCustomerIdsBySearch({ Customer: { findAll } }, "K")).toEqual([]);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("matches name, partial name, two-letter term, first+last, and company name", async () => {
    for (const term of ["Kamal", "am", "Ka", "Kamal Perera", "Apex Builders"]) {
      const findAll = vi.fn().mockResolvedValue([{ customer_id: 12 }]);
      const ids = await findCustomerIdsBySearch({ Customer: { findAll } }, term);
      expect(ids).toEqual([12]);
      const sql = inspect(findAll.mock.calls[0][0].where[Op.or], { depth: Infinity });
      expect(sql).toContain("first_name");
      expect(sql).toContain("last_name");
      expect(sql).toContain("company_name");
      expect(sql).toContain("CONCAT");
      expect(sql).toContain(`%${term}%`);
    }
  });

  it("matches NIC with and without trailing letter (case-insensitive, spaces stripped)", async () => {
    const findAll = vi.fn().mockResolvedValue([{ customer_id: 21 }]);
    expect(await findCustomerIdsBySearch({ Customer: { findAll } }, "90123 4567V")).toEqual([21]);
    let sql = inspect(findAll.mock.calls[0][0].where[Op.or], { depth: Infinity });
    expect(sql).toContain("nic_number");
    expect(sql).toContain("%901234567v%");

    findAll.mockClear();
    expect(await findCustomerIdsBySearch({ Customer: { findAll } }, "901234567")).toEqual([21]);
    sql = inspect(findAll.mock.calls[0][0].where[Op.or], { depth: Infinity });
    expect(sql).toContain("nic_number");
    expect(sql).toContain("%901234567%");
  });

  it("matches exact customer ID when whole number is typed", async () => {
    const findAll = vi.fn().mockResolvedValue([{ customer_id: 42 }]);
    expect(await findCustomerIdsBySearch({ Customer: { findAll } }, "42")).toEqual([42]);
    const orClauses = findAll.mock.calls[0][0].where[Op.or];
    expect(orClauses).toEqual(expect.arrayContaining([{ customer_id: 42 }]));
  });

  it("matches phone numbers in local and +94 international form", async () => {
    for (const phone of ["077 123 4567", "+94 77 123 4567"]) {
      const findAll = vi.fn().mockResolvedValue([{ customer_id: 7 }]);
      expect(await findCustomerIdsBySearch({ Customer: { findAll } }, phone)).toEqual([7]);
      const sql = inspect(findAll.mock.calls[0][0].where[Op.or], { depth: Infinity });
      expect(sql).toContain("phone_number");
      expect(sql).toContain("%771234567%");
    }
  });
});

describe("customerSearchOrder & customer list search", () => {
  it("orders exact customer ID -> exact NIC -> phone -> name, then most recently active first", () => {
    const idOrder = inspect(customerSearchOrder("42"), { depth: 4 });
    expect(idOrder).toContain("Customer.customer_id = 42 THEN 0");
    expect(idOrder).toContain("updatedAt");

    const nicOrder = inspect(customerSearchOrder("901234567V"), { depth: 4 });
    expect(nicOrder).toContain("'901234567v' THEN 1");
    expect(nicOrder).toContain("THEN 2");

    const nameOrder = inspect(customerSearchOrder("Ka"), { depth: 4 });
    expect(nameOrder).toContain("updatedAt");
    expect(nameOrder).not.toContain("CASE");
  });

  it("narrows getAllCustomers on name search and preserves skip_count fast path with limit 15", async () => {
    const findAll = vi.fn(async (opts) => {
      if (opts.attributes?.length === 1) return [{ customer_id: 1 }, { customer_id: 2 }];
      return [];
    });
    const m = {
      Customer: {
        findAll,
        findAndCountAll: vi.fn(async () => ({ count: 0, rows: [] })),
      },
    };
    await getAllCustomers(m, { search: "Kamal", limit: 15, skip_count: "true" });
    expect(m.Customer.findAndCountAll).not.toHaveBeenCalled();
    const listCall = findAll.mock.calls.find(([o]) => o.attributes?.length !== 1);
    expect(listCall[0].where.customer_id[Op.in]).toEqual([1, 2]);
    expect(listCall[0].limit).toBe(15);
  });
});

describe("phone contact search", () => {
  it("rejects a name", async () => {
    await expect(
      searchPhoneContacts({ PhoneContact: { findAll: vi.fn() } }, { search: "Kamal" }),
    ).rejects.toThrow(/phone number/i);
  });

  it("shows contacts only once 9 digits are typed", async () => {
    const findAll = vi.fn().mockResolvedValue([]);
    const models = { PhoneContact: { findAll } };

    await expect(searchPhoneContacts(models, { search: "07712345" })).rejects.toThrow(
      /at least 9 digits/i,
    );
    await expect(searchPhoneContacts(models, { search: "077 1234" })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(findAll).not.toHaveBeenCalled();

    await searchPhoneContacts(models, { search: "077123456" });
    expect(findAll).toHaveBeenCalledTimes(1);
  });

  it("matches only the stored phone digits", async () => {
    const findAll = vi.fn().mockResolvedValue([]);
    await searchPhoneContacts({ PhoneContact: { findAll } }, { search: "077 123 4567" });
    const where = findAll.mock.calls[0][0].where;
    expect(inspect(where[Op.or], { depth: 8 })).toContain("%771234567%");
    expect(inspect(where, { depth: 8 })).not.toContain("display_name");
  });
});
