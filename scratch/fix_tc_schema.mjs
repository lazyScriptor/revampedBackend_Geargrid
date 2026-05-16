import 'dotenv/config';
import { getTenantConnection, masterSequelize } from './src/config/database.js';
import { QueryTypes } from 'sequelize';

const tenants = await masterSequelize.query(
  'SELECT db_name, db_user, encrypted_db_pass, db_host FROM TENANTS',
  { type: QueryTypes.SELECT },
);

for (const t of tenants) {
  try {
    const conn = await getTenantConnection(t.db_name, t.db_user, t.encrypted_db_pass, t.db_host);
    await conn.query("ALTER TABLE TENANT_CONFIG MODIFY COLUMN config_id INT NOT NULL AUTO_INCREMENT");
    console.log(`✅ ${t.db_name}: config_id is now AUTO_INCREMENT`);
    await conn.close();
  } catch (e) {
    console.error(`❌ ${t.db_name}:`, e.message);
  }
}
await masterSequelize.close();
process.exit(0);
