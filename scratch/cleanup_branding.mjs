import 'dotenv/config';
import { masterSequelize, getTenantConnection } from '../src/config/database.js';
import { QueryTypes } from 'sequelize';

// 1. Clean polluted branding/feature_flags on master TENANTS
const tenants = await masterSequelize.query(
  'SELECT tenant_id, branding, feature_flags FROM TENANTS',
  { type: QueryTypes.SELECT },
);

const strip = (v) => {
  let obj = v;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { return v; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const cleaned = {};
  for (const k of Object.keys(obj)) if (!/^\d+$/.test(k)) cleaned[k] = obj[k];
  return cleaned;
};

for (const t of tenants) {
  const branding = strip(t.branding);
  const flags = strip(t.feature_flags);
  await masterSequelize.query(
    'UPDATE TENANTS SET branding = :b, feature_flags = :f WHERE tenant_id = :id',
    {
      replacements: {
        b: JSON.stringify(branding),
        f: JSON.stringify(flags),
        id: t.tenant_id,
      },
    },
  );
  console.log(`✅ Cleaned ${t.tenant_id}: branding=`, branding);
}

// 2. ALTER each tenant DB to give logo_url LONGTEXT capacity
const tenantList = await masterSequelize.query(
  'SELECT db_name, db_user, encrypted_db_pass, db_host FROM TENANTS',
  { type: QueryTypes.SELECT },
);
for (const t of tenantList) {
  try {
    const conn = await getTenantConnection(t.db_name, t.db_user, t.encrypted_db_pass, t.db_host);
    await conn.query('ALTER TABLE TENANT_CONFIG MODIFY COLUMN logo_url LONGTEXT NULL');
    console.log(`✅ ${t.db_name}: logo_url is now LONGTEXT`);
    await conn.close();
  } catch (e) {
    console.error(`❌ ${t.db_name}:`, e.message);
  }
}

await masterSequelize.close();
process.exit(0);
