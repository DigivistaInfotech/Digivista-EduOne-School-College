import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../migrations');
const outputFile = path.resolve(__dirname, '../supabase/00_master_supabase_schema.sql');

async function generateMasterSchema() {
  console.log('Generating Standalone Master Supabase Schema...');

  const files = (await readdir(migrationsDir))
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort((a, b) => a.localeCompare(b));

  let output = `-- ============================================================================
-- ASTERLEAF SCHOOL ERP — MASTER SUPABASE CONSOLIDATED SCHEMA (0001 - ${files.at(-1)?.slice(0, 4) ?? '0000'})
-- ============================================================================
-- Target Database: Brand-New Supabase PostgreSQL Database
-- Modules Covered: Full 30-Module Directory (Nursery to Class XII)
-- Includes:
--   1. Extensions (pgcrypto, uuid-ossp)
--   2. Multi-tenant Schema Migrations (0001 to ${files.at(-1)?.slice(0, 4) ?? '0000'})
--   3. Row-Level Security (RLS) & Tenant Isolation Policies
--   4. Supabase Auth Interoperability (current_app_user_id, current_app_school_id)
--   5. Pre-populated schema_migrations with exact SHA-256 checksums
-- ============================================================================

-- Enable required PostgreSQL extensions in Supabase
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Ensure erp_app application role exists if running on standard PostgreSQL or Supabase
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app;
  END IF;
END $$;

-- Track schema migrations for node-pg / backend runner interoperability
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

`;

  const migrationRecords: Array<{ file: string; checksum: string }> = [];

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const content = await readFile(fullPath, 'utf8');
    const checksum = createHash('sha256').update(content).digest('hex');
    migrationRecords.push({ file, checksum });

    output += `\n-- ----------------------------------------------------------------------------\n`;
    output += `-- Migration: ${file} (SHA-256: ${checksum})\n`;
    output += `-- ----------------------------------------------------------------------------\n\n`;
    output += content.trim();
    output += `\n\n`;
  }

  output += `-- ============================================================================\n`;
  output += `-- RECORD ALL 34 MIGRATION CHECKSUMS IN schema_migrations\n`;
  output += `-- ============================================================================\n`;
  output += `INSERT INTO schema_migrations (version, checksum, applied_at)\nVALUES\n`;

  const valuesClauses = migrationRecords.map(
    (m) => `  ('${m.file}', '${m.checksum}', now())`
  );
  output += valuesClauses.join(',\n');
  output += `\nON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum;\n\n`;

  output += `-- Grant full schema privileges to Supabase authenticated and erp_app roles\n`;
  output += `GRANT USAGE ON SCHEMA public TO erp_app, authenticated, service_role;\n`;
  output += `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO erp_app, authenticated, service_role;\n`;
  output += `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO erp_app, authenticated, service_role;\n`;
  output += `GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO erp_app, authenticated, service_role;\n\n`;
  output += `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO erp_app, authenticated, service_role;\n`;
  output += `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO erp_app, authenticated, service_role;\n`;
  output += `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO erp_app, authenticated, service_role;\n`;

  await writeFile(outputFile, output, 'utf8');
  console.log(`✅ Successfully generated master Supabase schema: ${outputFile} (${files.length} migrations included)`);
}

generateMasterSchema().catch((err) => {
  console.error('Failed to generate master schema:', err);
  process.exit(1);
});
