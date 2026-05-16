import 'dotenv/config';
import { getTenantConnection, masterSequelize } from '/Users/theeka/Desktop/revampedBackend/src/config/database.js';

const conn = await getTenantConnection('geargrid_tenant_template', process.env.USERNAME, process.env.PASSWORD, process.env.HOST);
const [results] = await conn.query("SHOW CREATE TABLE TENANT_CONFIG");
console.log(results[0]['Create Table']);
const [rows] = await conn.query("SELECT * FROM TENANT_CONFIG");
console.log('\nROWS:', JSON.stringify(rows, null, 2));
await conn.close();
await masterSequelize.close();
process.exit(0);
