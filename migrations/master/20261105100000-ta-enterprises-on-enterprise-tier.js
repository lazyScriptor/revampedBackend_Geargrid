// T.A Enterprises is an Enterprise customer. Plans start being enforced with this release, and until
// now the tier was only a label, so set it before anything depends on it. Safe to run twice.
const DB_NAME = "geargrid_t_a_enterprises_mv8kypdv";

export const up = async ({ context: queryInterface }) => {
  await queryInterface.sequelize.query("UPDATE TENANTS SET tier = 'Enterprise' WHERE db_name = :db", { replacements: { db: DB_NAME } });
};

// The earlier value was never meaningful, so there is nothing to put back.
export const down = async () => {};
