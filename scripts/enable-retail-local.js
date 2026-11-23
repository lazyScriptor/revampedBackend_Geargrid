import dotenv from "dotenv";

// Load .env without overriding explicit CLI env vars (e.g. NODE_ENV=development)
dotenv.config({ override: false });

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const env = (process.env.NODE_ENV || "development").toLowerCase();
const host = (process.env.HOST || process.env.DB_HOST || "localhost").toLowerCase();

if (env === "production") {
  console.error("Refusing to run: NODE_ENV is 'production'.");
  process.exit(1);
}
if (!LOCAL_HOSTS.has(host)) {
  console.error(`Refusing to run: HOST (${host}) must be localhost or 127.0.0.1.`);
  process.exit(1);
}

const dbName = process.argv[2];
if (!dbName) {
  console.error("Usage: node scripts/enable-retail-local.js <db_name>");
  process.exit(1);
}

const parseJson = (v) => {
  if (!v) return {};
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v) || {};
  } catch {
    return {};
  }
};

(async () => {
  try {
    const { masterSequelize } = await import("../src/config/database.js");
    const { initMasterModels } = await import("../src/models/master/index.js");

    await masterSequelize.authenticate();
    const { Tenant } = initMasterModels(masterSequelize);
    const tenant = await Tenant.findOne({ where: { db_name: dbName } });
    if (!tenant) {
      console.error(`Tenant not found: ${dbName}`);
      process.exit(1);
    }

    const flags = parseJson(tenant.feature_flags);
    const overrides =
      flags.plan_overrides && typeof flags.plan_overrides === "object"
        ? flags.plan_overrides
        : {};
    const features =
      overrides.features && typeof overrides.features === "object"
        ? overrides.features
        : {};

    const nextFlags = {
      ...flags,
      plan_overrides: {
        ...overrides,
        features: {
          ...features,
          retail: true,
        },
      },
    };

    await tenant.update({ feature_flags: nextFlags });
    console.log(`✅ Enabled retail plan override for ${dbName}`);
    process.exit(0);
  } catch (err) {
    console.error("Failed to enable retail override:", err.message);
    process.exit(1);
  }
})();
