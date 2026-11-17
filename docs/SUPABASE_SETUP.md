# Asterleaf School ERP — Supabase PostgreSQL Setup & Deployment Guide

This guide details the complete procedure for deploying Asterleaf School ERP to a brand-new **Supabase PostgreSQL** project.

---

## 1. Prerequisites & Project Creation

1. Log into your [Supabase Dashboard](https://supabase.com/dashboard).
2. Click **New Project** and configure:
   - **Project Name**: `asterleaf-school-erp` (or your institution's name).
   - **Database Password**: Generate and securely store a strong password.
   - **Region**: Choose a region close to your school (e.g. `ap-south-1` Mumbai for Indian schools).
   - **Pricing Plan**: Free or Pro tier.
3. Wait for the database provisioning to complete (typically 1–2 minutes).

---

## 2. Obtain Connection Strings & API Keys

Navigate to **Project Settings** in your Supabase dashboard:

### Database Connection String
Go to **Project Settings > Database > Connection string**:
- Select **URI**.
- For production and migration execution, select **Connection Pooling**:
  - **Transaction Mode (Port 6543)**: Ideal for high-scale, serverless API queries.
  - **Session Mode (Port 5432)**: Required for running DDL migrations and schema setup.

Example URI:
```env
DATABASE_URL=postgres://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
DATABASE_SSL=true
```

### API Credentials
Go to **Project Settings > API**:
- **Project URL**: `https://<project-ref>.supabase.co`
- **anon public key**: `eyJhbGciOi...` (Safe to use in frontend browser applications).
- **service_role secret key**: `eyJhbGciOi...` (**STRICTLY CONFIDENTIAL**: only used in backend API or migration runners; NEVER bundle into frontend code).

Add these to your local `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

---

## 3. Applying the Database Schema

You can apply the complete 30-module schema to your new Supabase database via either of two supported methods:

### Option A: Direct SQL Editor (Fastest & Simplest)

1. Open your Supabase Dashboard and click on the **SQL Editor** tab in the left sidebar.
2. Click **New Query**.
3. Open the file [`packages/db/supabase/00_master_supabase_schema.sql`](../packages/db/supabase/00_master_supabase_schema.sql).
4. Copy its entire content (195 KB consolidated DDL) and paste it into the Supabase SQL Editor.
5. Click **Run** (or press `Ctrl+Enter`).
6. The query will execute all 34 migrations in strict dependency order, configure extensions, apply Row-Level Security (RLS) policies, and record migration checksums in the `schema_migrations` table.

### Option B: Automated Node Migration Runner

If you have configured `DATABASE_URL` in `.env`:

```bash
# Verify database connection
npm run db:migrate
```

The migration runner reads all 34 migration files in order, checks SHA-256 checksums, and applies them transactionally.

---

## 4. Seeding Realistic High-Scale CBSE Data

Asterleaf School ERP includes a comprehensive Indian CBSE seed dataset covering Nursery through Class XII:

```bash
# Execute the high-scale CBSE demo seed
npm run db:seed:demo
```

### Seed Dataset Highlights
- **1,270+ Enrolled Students**: Spanning Nursery, LKG, UKG, Classes 1–10 (Sections A & B), and Classes 11–12 across Science, Commerce, and Humanities streams. Authentic Indian student profiles with CBSE registration numbers, blood groups, and emergency contacts.
- **85+ Realistic Staff Members**: Principals, academic coordinators, class teachers, subject specialists, lab assistants, transport managers, bus attendants, and accounts staff with salary structures and biometric profiles.
- **Full CBSE Subject Catalogue**: Stage-wise foundational, middle, secondary, and senior elective subjects (Physics, Chemistry, Biology, Accountancy, Economics, Computer Science, AI, History, Political Science, Early Numeracy, etc.).
- **Transport Fleet**: 5 commercial school buses (including Bharat Stage BH-series vehicles), GPS geofences, routes, stops, and student bus pass allocations.
- **Library Directory**: 32+ physical book copies across core CBSE NCERT textbooks and Indian literature.
- **Attendance & Shortage Register**: Historical daily attendance, period attendance, and sample CBSE Rule 14.2 medical/sports condonation cases under 80% threshold.
- **Facilities & Maintenance**: Auditorium, science labs, computer labs, sports complex, and maintenance tickets.
- **PTM & Certificates**: PTM conferences, confirmed bookings, Transfer Certificates (TC), and Bonafide certificates with SHA-256 verification hashes.
- **School Clubs & Alumni**: Robotics club, Literary society, Eco club, Math Olympiad society, and verified alumni records.

---

## 5. Security & Row-Level Security (RLS) Architecture

Asterleaf School ERP implements deep database-level security:

1. **Row Level Security (RLS)** is enabled on all tenant and operational tables.
2. The `tenant_isolation` policy restricts rows according to `school_id`.
3. In Supabase environments, authentication context is extracted via `current_app_user_id()` and `current_app_school_id()`, which interoperate with `auth.jwt()`.
4. Role permissions are enforced at the API route handler and database policy level.
5. The `service_role` key bypasses RLS for administrative maintenance scripts only and is never transmitted to client browsers.

---

## 6. Pre-Configured Demo Credentials

The seeded database includes pre-configured persona accounts for testing distinct role-based dashboards:

| Role | Email | Password | Primary Scope |
| :--- | :--- | :--- | :--- |
| **Super Admin / Principal** | `admin@demo.test` | `Admin@12345` | School-wide administrative oversight |
| **Academic Coordinator** | `coordinator@demo.test` | `Coord@12345` | Timetable, curriculum & syllabus tracking |
| **Class Teacher** | `teacher@demo.test` | `Teacher@12345` | Class 1-A & assigned subjects |
| **Student (Senior)** | `student@demo.test` | `Student@12345` | Kabir Menon (Class 10-A) |
| **Student (Middle)** | `aarav@demo.test` | `Student@12345` | Aarav Sharma (Class 6-A) |
| **Parent / Guardian** | `parent@demo.test` | `Parent@12345` | Priya Sharma (Mother of Aarav & Anaya) |
| **Finance Manager** | `finance@demo.test` | `Finance@12345` | Fee collection, ledger & offline queues |
| **HR Lead** | `hr@demo.test` | `Staff@12345` | Staff profiles, leaves & biometric punches |
| **Transport Manager** | `transport@demo.test` | `Staff@12345` | Bus fleet, routes, stops & GPS tracking |
| **Chief Librarian** | `librarian@demo.test` | `Staff@12345` | Book accession, issues & overdue fines |
| **Internal Auditor** | `auditor@demo.test` | `Auditor@12345` | Append-only audit logs & compliance reviews |

---

## 7. Starting the Application

Once the database is migrated and seeded:

```bash
# Start backend API (Port 4000)
npm run dev:api

# Start web frontend (Port 5173)
npm run dev:web
```

Visit `http://localhost:5173` to access the Asterleaf School ERP login portal.
