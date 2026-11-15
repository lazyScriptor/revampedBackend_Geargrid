import { Op } from "sequelize";
import {
  customerSearchOrder,
  findCustomerIdsBySearch,
} from "../utils/customerSearch.js";
import AppError from "../utils/AppError.js";
import { extractCustomerPhoneEntries, syncCustomerPhones } from "./customerPhoneService.js";
import { notifyEvent } from "./pushEventService.js";

const formatCustomerLabel = (c) => {
  if (!c) return "Customer";
  if (c.customer_type === "Business" && c.company_name) return c.company_name;
  return `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.nic_number || "Customer";
};

const runInTransaction = async (models, fn) => {
  if (models?.sequelize?.transaction) {
    return await models.sequelize.transaction(fn);
  }
  return await fn(undefined);
};

export const createCustomer = async (models, data) => {
  // 1. Uniqueness Check: Ensure NIC/Passport doesn't already exist
  if (data.nic_number) {
    const existingCustomer = await models.Customer.findOne({
      where: { nic_number: data.nic_number },
    });
    if (existingCustomer) {
      throw new AppError(
        "A customer with this NIC or Passport already exists.",
        400,
      );
    }
  }

  // 2. Hierarchical Validation: parent can be any active customer (Individual
  //    or Business). The rental shop sometimes registers family members where
  //    a son/daughter rents on behalf of a parent who isn't a company.
  if (data.parent_customer_id) {
    const parent = await models.Customer.findByPk(data.parent_customer_id);
    if (!parent || parent.customer_delete_status) {
      throw new AppError("The selected parent customer is invalid.", 400);
    }
    if (parent.status === "Blacklisted") {
      throw new AppError(
        "Cannot link to a blacklisted parent customer.",
        400,
      );
    }
  }

  // 3. Create the customer and sync normalised phone index in one transaction
  const sourceContactId = data.source_contact_id ? Number(data.source_contact_id) : null;
  const createPayload = {
    ...data,
    ...(sourceContactId ? { source_contact_id: sourceContactId } : {}),
    brief_changed_at: new Date(),
  };

  return await runInTransaction(models, async (t) => {
    const opts = t ? { transaction: t } : {};
    const customer = await models.Customer.create(createPayload, opts);
    await syncCustomerPhones(models, customer, opts);

    if (sourceContactId && models.PhoneContact) {
      const sourceContact = models.PhoneContact.findByPk
        ? await models.PhoneContact.findByPk(sourceContactId, opts)
        : null;
      const numbers = new Set(
        extractCustomerPhoneEntries(customer.phone_number).map((e) => e.phone_e164),
      );
      if (sourceContact?.phone_e164) numbers.add(sourceContact.phone_e164);

      const orConditions = [{ contact_id: sourceContactId }];
      if (sourceContact?.operator_device_id && sourceContact?.device_contact_key) {
        orConditions.push({
          operator_device_id: sourceContact.operator_device_id,
          device_contact_key: sourceContact.device_contact_key,
        });
      }
      if (numbers.size > 0) {
        orConditions.push({ phone_e164: { [Op.in]: [...numbers] } });
      }

      if (models.PhoneContact.update) {
        await models.PhoneContact.update(
          { linked_customer_id: customer.customer_id },
          { where: { [Op.or]: orConditions }, ...opts },
        );
      }
    }

    return customer;
  });
};

export const getAllCustomers = async (models, queryParams) => {
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  // 1. Base query: Hide soft-deleted customers
  const whereClause = { customer_delete_status: false };

  // 2. Dynamic Search (name, customer ID, NIC, phone number)
  if (queryParams.search) {
    whereClause.customer_id = {
      [Op.in]: await findCustomerIdsBySearch(models, queryParams.search),
    };
  }

  // 2b. Exact-match filters for the table UI
  // Accepts: customer_type=Individual|Business, status=Active|Blacklisted,
  //          id_retained=true|false (drives the "IDs in vault" chip)
  if (queryParams.customer_type) {
    whereClause.customer_type = queryParams.customer_type;
  }
  if (queryParams.status) {
    whereClause.status = queryParams.status;
  }
  if (typeof queryParams.id_retained !== "undefined" && queryParams.id_retained !== "") {
    whereClause.is_id_retained_currently =
      queryParams.id_retained === "true" || queryParams.id_retained === true;
  }
  if (typeof queryParams.has_parent !== "undefined" && queryParams.has_parent !== "") {
    const wantsParent = queryParams.has_parent === "true" || queryParams.has_parent === true;
    whereClause.parent_customer_id = wantsParent ? { [Op.ne]: null } : { [Op.is]: null };
  }

  const orderClause = queryParams.search
    ? customerSearchOrder(queryParams.search)
    : [
        ["createdAt", "DESC"],
        ["customer_id", "DESC"],
      ];

  // 2c. Fast-path: When skip_count is true (e.g. for POS live search / autocompletes),
  // skip the expensive SELECT count(*) table scan completely
  if (queryParams.skip_count === "true" || queryParams.skip_count === true) {
    const rows = await models.Customer.findAll({
      where: whereClause,
      include: [
        {
          model: models.Customer,
          as: "ParentCompany",
          attributes: ["customer_id", "company_name"],
        },
      ],
      limit,
      offset,
      // customer_id breaks createdAt ties (bulk imports) so OFFSET paging is stable
      order: orderClause,
    });

    return {
      totalItems: rows.length,
      totalPages: 1,
      currentPage: page,
      customers: rows,
    };
  }

  // 3. Execute Query with Relational Includes
  const { count, rows } = await models.Customer.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: models.Customer,
        as: "ParentCompany", // Pulls the parent company data for the frontend badge
        attributes: ["customer_id", "company_name"],
      },
    ],
    limit,
    offset,
    order: orderClause,
  });

  return {
    totalItems: count,
    totalPages: Math.ceil(count / limit),
    currentPage: page,
    customers: rows,
  };
};

export const getCustomerById = async (models, customerId) => {
  // Fetch a single customer with their full CRM context
  const customer = await models.Customer.findOne({
    where: {
      customer_id: customerId,
      customer_delete_status: false,
    },
    include: [
      {
        model: models.Customer,
        as: "ParentCompany",
        attributes: [
          "customer_id",
          "company_name",
          "first_name",
          "last_name",
          "phone_number",
        ],
      },
      {
        model: models.Customer,
        as: "Workers", // If this is a business, who are their workers?
        attributes: [
          "customer_id",
          "first_name",
          "last_name",
          "phone_number",
          "status",
        ],
      },
      {
        model: models.Invoice,
        required: false, // Invoice has a default scope (hides deleted) — never turn this into an INNER JOIN
        attributes: ["invoice_id", "total_amount", "accrued_charges", "status", "issued_date"],
        limit: 5, // Top 5 recent invoices for the POS Snapshot widget
        order: [["issued_date", "DESC"]],
      },
    ],
  });

  if (!customer) throw new AppError("Customer not found.", 404);
  return customer;
};

// Retrieve complete invoice history & stats for a specific customer
export const getCustomerInvoices = async (models, customerId) => {
  const invoices = await models.Invoice.findAll({
    where: {
      [Op.or]: [
        { customer_id: customerId },
        { borrowed_on_behalf_of_customer_id: customerId },
      ],
    },
    include: [
      {
        model: models.InvoiceLine,
        include: [
          {
            model: models.Equipment,
            attributes: ["equipment_id", "equipment_name", "is_bulk_item"],
          },
        ],
      },
      {
        model: models.Payment,
        attributes: ["payment_id", "payment_amount", "payment_date", "method"],
      },
      {
        model: models.Customer,
        attributes: [
          "customer_id",
          "first_name",
          "last_name",
          "company_name",
          "phone_number",
          "nic_number",
          "customer_type",
        ],
      },
      {
        model: models.InvoiceTrace,
        attributes: [
          "trace_id",
          "event_category",
          "event_action",
          "comments",
          "createdAt",
        ],
        required: false,
      },
    ],
    order: [["issued_date", "DESC"]],
  });

  const total = invoices.length;
  let active = 0;
  let completed = 0;

  for (const inv of invoices) {
    if (inv.status === "Active") active++;
    else if (inv.status === "Completed") completed++;
  }

  return {
    invoices,
    stats: {
      total,
      active,
      completed,
    },
  };
};

export const updateCustomer = async (models, customerId, updateData, actorUserId = null) => {
  // We use the basic findByPk here to avoid pulling in all the relations just to update
  const customer = await models.Customer.findByPk(customerId);
  if (!customer || customer.customer_delete_status) {
    throw new AppError("Customer not found.", 404);
  }
  const previousStatus = customer.status;

  // If they are updating the NIC, ensure it doesn't belong to someone else
  if (updateData.nic_number && updateData.nic_number !== customer.nic_number) {
    const existing = await models.Customer.findOne({
      where: { nic_number: updateData.nic_number },
    });
    if (existing)
      throw new AppError(
        "This NIC/Passport is already registered to another customer.",
        400,
      );
  }

  await runInTransaction(models, async (t) => {
    const opts = t ? { transaction: t } : {};
    await customer.update({ ...updateData, brief_changed_at: new Date() }, opts);
    if ("phone_number" in updateData || "customer_delete_status" in updateData) {
      await syncCustomerPhones(models, customer, opts);
    }
  });

  if (previousStatus !== "Blacklisted" && updateData.status === "Blacklisted") {
    const label = formatCustomerLabel({ ...customer.toJSON?.(), ...updateData });
    void notifyEvent(models, "customer_blacklisted", {
      actorUserId,
      customerName: label,
      vars: { customer: label, reason: "", staff: "" },
      title: `Customer blacklisted: ${label}`,
      body: `${label}${customer.phone_number ? ` · ${customer.phone_number}` : ""} was marked Blacklisted.`,
      data: { type: "customer_blacklisted", customer_id: String(customerId) },
      link: "/customers",
    });
  }

  // Return the updated customer with full relational data
  return await getCustomerById(models, customerId);
};

// Bonus: Soft Delete logic since you have `customer_delete_status` in your schema
export const deleteCustomer = async (models, customerId) => {
  const customer = await models.Customer.findByPk(customerId);
  if (!customer) throw new AppError("Customer not found.", 404);

  if (customer.is_id_retained_currently) {
    throw new AppError("Cannot delete customer. Physical ID card is currently held in the vault.", 400);
  }

  if (models.Invoice) {
    const activeInvoiceCount = await models.Invoice.count({
      where: {
        customer_id: customerId,
        status: { [Op.in]: ["Active", "PendingPayment"] },
      },
    });
    if (activeInvoiceCount > 0) {
      throw new AppError("Cannot delete customer with active rental contracts or outstanding balances.", 400);
    }
  }

  // Soft-delete the record and drop indexed phone lookup rows
  await runInTransaction(models, async (t) => {
    const opts = t ? { transaction: t } : {};
    await customer.update({ customer_delete_status: true, brief_changed_at: new Date() }, opts);
    await syncCustomerPhones(models, customer, opts);
  });
  return true;
};

// Lightweight parent-options query, used by the customer form's parent
// dropdown. Excludes self (so a customer can't be their own parent) and
// supports an optional `search` term that matches the same fields the POS
// search uses, so the dropdown can mirror that "type to find" behaviour.
//
// `customer_delete_status` is checked with `Op.not: true` so legacy rows where
// the column is NULL still show up. Blacklisted customers are returned and
// filtered at submit time — hiding them here just confused users who couldn't
// find an account they knew existed.
export const getParentOptions = async (models, { excludeId, search } = {}) => {
  const where = { customer_delete_status: { [Op.not]: true } };
  if (excludeId) {
    where.customer_id = { [Op.ne]: excludeId };
  }
  if (search && String(search).trim().length > 0) {
    // Match by name, customer ID, NIC, or phone. excludeId is kept as a separate condition.
    where[Op.and] = [{ customer_id: { [Op.in]: await findCustomerIdsBySearch(models, search) } }];
  }
  return models.Customer.findAll({
    where,
    attributes: [
      "customer_id",
      "customer_type",
      "first_name",
      "last_name",
      "company_name",
      "phone_number",
      "nic_number",
      "status",
    ],
    order: [["createdAt", "DESC"]],
    limit: 50,
  });
};

export const bulkUpdateCustomers = async (models, payload, actorUserId = null) => {
  const { ids, updates } = payload;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError("No customer IDs provided for bulk update.", 400);
  }

  if (!updates || Object.keys(updates).length === 0) {
    throw new AppError("No update fields provided.", 400);
  }

  const newlyBlacklisted = [];

  const result = await models.sequelize.transaction(async (t) => {
    const customers = await models.Customer.findAll({
      where: {
        customer_id: { [Op.in]: ids },
        customer_delete_status: false,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (customers.length === 0) {
      throw new AppError("No matching active customers found.", 404);
    }

    const {
      status,
      customer_type,
      rating,
      parent_customer_id,
      deposit_balance_adjustment,
    } = updates;

    // Validate parent customer if provided
    if (parent_customer_id) {
      if (ids.map(Number).includes(Number(parent_customer_id))) {
        throw new AppError("A customer cannot be set as their own parent company.", 400);
      }
      const parent = await models.Customer.findByPk(parent_customer_id, { transaction: t });
      if (!parent || parent.customer_delete_status) {
        throw new AppError("Selected parent customer is invalid.", 400);
      }
      if (parent.status === "Blacklisted") {
        throw new AppError("Cannot link to a blacklisted parent customer.", 400);
      }
    }

    const updatedIds = [];

    for (const cust of customers) {
      const custPatch = {};

      if (status !== undefined && ["Active", "Blacklisted"].includes(status)) {
        custPatch.status = status;
      }

      if (customer_type !== undefined && ["Individual", "Business"].includes(customer_type)) {
        custPatch.customer_type = customer_type;
      }

      if (rating !== undefined && rating !== "") {
        const r = parseInt(rating, 10);
        if (r >= 1 && r <= 5) custPatch.rating = r;
      }

      // Link or unlink parent
      if (parent_customer_id !== undefined) {
        custPatch.parent_customer_id =
          parent_customer_id === null || parent_customer_id === "" ? null : Number(parent_customer_id);
      }

      // Deposit balance adjustment
      if (deposit_balance_adjustment && typeof deposit_balance_adjustment.value === "number") {
        const { type, value } = deposit_balance_adjustment;
        const currentDeposit = parseFloat(cust.deposit_balance) || 0;
        if (type === "set") {
          custPatch.deposit_balance = Math.max(0, value);
        } else if (type === "add") {
          custPatch.deposit_balance = Math.max(0, currentDeposit + value);
        }
      }

      if (Object.keys(custPatch).length > 0) {
        const wasBlacklisted = cust.status === "Blacklisted";
        custPatch.brief_changed_at = new Date();
        await cust.update(custPatch, { transaction: t });
        if ("phone_number" in custPatch || "customer_delete_status" in custPatch) {
          await syncCustomerPhones(models, cust, { transaction: t });
        }
        if (!wasBlacklisted && custPatch.status === "Blacklisted") {
          newlyBlacklisted.push({
            customer_id: cust.customer_id,
            label: formatCustomerLabel(cust),
            phone: cust.phone_number || "",
          });
        }
        updatedIds.push(cust.customer_id);
      }
    }

    return {
      updatedCount: updatedIds.length,
      ids: updatedIds,
    };
  });

  for (const item of newlyBlacklisted) {
    void notifyEvent(models, "customer_blacklisted", {
      actorUserId,
      customerName: item.label,
      vars: { customer: item.label, reason: "", staff: "" },
      title: `Customer blacklisted: ${item.label}`,
      body: `${item.label}${item.phone ? ` · ${item.phone}` : ""} was marked Blacklisted.`,
      data: { type: "customer_blacklisted", customer_id: String(item.customer_id) },
      link: "/customers",
    });
  }

  return result;
};

export const getCustomerStats = async (models) => {
  const [stats] = await models.Customer.findAll({
    attributes: [
      [models.sequelize.fn("COUNT", models.sequelize.col("customer_id")), "totalClients"],
      [models.sequelize.literal(`COALESCE(SUM(CASE WHEN customer_type = 'Business' THEN 1 ELSE 0 END), 0)`), "businessCount"],
      [models.sequelize.literal(`COALESCE(SUM(CASE WHEN customer_type = 'Individual' THEN 1 ELSE 0 END), 0)`), "individualCount"],
      [models.sequelize.literal(`COALESCE(SUM(CASE WHEN is_id_retained_currently = 1 THEN 1 ELSE 0 END), 0)`), "idsInVault"],
      [models.sequelize.literal(`COALESCE(SUM(deposit_balance), 0)`), "totalAdvance"],
      [models.sequelize.literal(`COALESCE(SUM(CASE WHEN parent_customer_id IS NOT NULL THEN 1 ELSE 0 END), 0)`), "linkedToParent"],
    ],
    where: { customer_delete_status: false },
    raw: true,
  });

  return {
    totalClients: Number(stats?.totalClients || 0),
    businessCount: Number(stats?.businessCount || 0),
    individualCount: Number(stats?.individualCount || 0),
    idsInVault: Number(stats?.idsInVault || 0),
    totalAdvance: Number(stats?.totalAdvance || 0),
    linkedToParent: Number(stats?.linkedToParent || 0),
  };
};

