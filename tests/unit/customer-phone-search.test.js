import { describe, it, expect, vi } from "vitest";
import { inspect } from "node:util";
import { Op } from "sequelize";
import {
  phoneSearchCore,
  isWholeNumber,
  findCustomerIdsByPhoneSearch,
  idsForSqlIn,
} from "../../src/utils/customerPhoneSearch.js";
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

  it("recognises invoice numbers", () => {
    expect(isWholeNumber(" 104 ")).toBe(true);
    expect(isWholeNumber("INV-104")).toBe(false);
  });

  it("never sends an empty IN () list to raw SQL", () => {
    expect(idsForSqlIn([])).toEqual([-1]);
    expect(idsForSqlIn([3, 4])).toEqual([3, 4]);
  });
});

describe("findCustomerIdsByPhoneSearch", () => {
  it("does not query at all for a name", async () => {
    const findAll = vi.fn();
    expect(await findCustomerIdsByPhoneSearch({ Customer: { findAll } }, "Kamal")).toEqual([]);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("matches the formatted phone column and never a name column", async () => {
    const findAll = vi.fn().mockResolvedValue([{ customer_id: 7 }]);
    expect(await findCustomerIdsByPhoneSearch({ Customer: { findAll } }, "077 123 4567")).toEqual([7]);
    const sql = inspect(findAll.mock.calls[0][0].where[Op.and], { depth: Infinity });
    expect(sql).toContain("phone_number");
    expect(sql).toContain("%771234567%");
    expect(sql).not.toMatch(/first_name|last_name|company_name|nic_number/);
  });
});

describe("customer list search", () => {
  const modelsWith = (matchingIds) => {
    const findAll = vi.fn(async (opts) => {
      if (opts.attributes?.length === 1) return matchingIds.map((id) => ({ customer_id: id }));
      return [];
    });
    return { Customer: { findAll, findAndCountAll: vi.fn(async () => ({ count: 0, rows: [] })) }, findAll };
  };

  it("a name search returns nobody instead of matching names", async () => {
    const m = modelsWith([1, 2]);
    await getAllCustomers(m, { search: "Kamal", skip_count: "true" });
    const listCall = m.findAll.mock.calls.find(([o]) => o.attributes?.length !== 1);
    expect(listCall[0].where.customer_id[Op.in]).toEqual([]);
  });

  it("a phone search narrows the list to customers with that number", async () => {
    const m = modelsWith([5]);
    await getAllCustomers(m, { search: "0771234567", skip_count: "true" });
    const listCall = m.findAll.mock.calls.find(([o]) => o.attributes?.length !== 1);
    expect(listCall[0].where.customer_id[Op.in]).toEqual([5]);
  });
});

describe("phone contact search", () => {
  it("rejects a name", async () => {
    await expect(searchPhoneContacts({ PhoneContact: { findAll: vi.fn() } }, { search: "Kamal" })).rejects.toThrow(
      /phone number/i,
    );
  });

  it("shows contacts only once 9 digits are typed", async () => {
    const findAll = vi.fn().mockResolvedValue([]);
    const models = { PhoneContact: { findAll } };

    await expect(searchPhoneContacts(models, { search: "07712345" })).rejects.toThrow(/at least 9 digits/i);
    await expect(searchPhoneContacts(models, { search: "077 1234" })).rejects.toMatchObject({ statusCode: 400 });
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
