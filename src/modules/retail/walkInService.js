import { Op } from "sequelize";

/**
 * Find or lazily create the built-in walk-in customer for a tenant.
 */
export const ensureWalkInCustomer = async (models, { transaction } = {}) => {
  const opts = transaction ? { transaction } : {};

  let customer = await models.Customer.findOne({
    where: {
      [Op.or]: [{ is_walk_in: true }, { nic_number: "WALK-IN" }],
    },
    ...opts,
  });

  if (customer) {
    if (!customer.is_walk_in) {
      await customer.update({ is_walk_in: true }, opts);
    }
    return customer;
  }

  customer = await models.Customer.create(
    {
      customer_type: "Individual",
      nic_number: "WALK-IN",
      first_name: "Walk-in",
      last_name: "customer",
      phone_number: "0000000000",
      is_walk_in: true,
      price_level: "retail",
      status: "Active",
      customer_delete_status: false,
    },
    opts,
  );

  return customer;
};
