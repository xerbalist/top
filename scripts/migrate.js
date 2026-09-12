import pg from 'pg';
import fs from 'node:fs/promises';
const url=process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if(!url)throw new Error('MIGRATION_DATABASE_URL nije podešen.');
const pool=new pg.Pool({connectionString:url,connectionTimeoutMillis:5000});
try {
  await pool.query(await fs.readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  console.log('Migracija je završena.');
} finally {await pool.end();}
