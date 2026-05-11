#!/usr/bin/env node
/**
 * Seed Super Admin
 * Usage: node src/scripts/seedSuperAdmin.js --email admin@geargrid.live --password yourSecurePassword
 */
import bcrypt from "bcrypt";
import { masterSequelize } from "../config/database.js";
import { initMasterModels } from "../models/master/index.js";

const args = process.argv.slice(2);
const emailIdx = args.indexOf("--email");
const passIdx = args.indexOf("--password");
const nameIdx = args.indexOf("--name");

if (emailIdx === -1 || passIdx === -1) {
  console.error(
    "Usage: node src/scripts/seedSuperAdmin.js --email <email> --password <password> [--name <name>]",
  );
  process.exit(1);
}

const email = args[emailIdx + 1];
const password = args[passIdx + 1];
const displayName = nameIdx !== -1 ? args[nameIdx + 1] : "Super Admin";

(async () => {
  try {
    await masterSequelize.authenticate();
    const { SuperAdmin } = initMasterModels(masterSequelize);
    await masterSequelize.sync();

    // Check if already exists
    const existing = await SuperAdmin.findOne({ where: { email } });
    if (existing) {
      console.log(`⚠️  Super Admin with email "${email}" already exists.`);
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await SuperAdmin.create({
      email,
      password_hash: passwordHash,
      display_name: displayName,
      is_active: true,
    });

    console.log(`✅ Super Admin created: ${email}`);
    console.log(`   Display Name: ${displayName}`);
    console.log(`   Login at: /super-admin/login`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed failed:", error.message);
    process.exit(1);
  }
})();
