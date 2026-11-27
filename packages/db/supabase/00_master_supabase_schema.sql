-- ============================================================================
-- ASTERLEAF SCHOOL ERP — MASTER SUPABASE CONSOLIDATED SCHEMA (0001 - 0045)
-- ============================================================================
-- Target Database: Brand-New Supabase PostgreSQL Database
-- Modules Covered: Full 30-Module Directory (Nursery to Class XII)
-- Includes:
--   1. Extensions (pgcrypto, uuid-ossp)
--   2. Multi-tenant Schema Migrations (0001 to 0045)
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


-- ----------------------------------------------------------------------------
-- Migration: 0001_foundation.sql (SHA-256: 23a5cbbbdf1753343cd42078a9909ca10f1c5989872d198396e982dfc50f70a3)
-- ----------------------------------------------------------------------------

-- 0001 Foundation: tenancy, identity, RBAC, sessions, audit.
-- School ERP | PostgreSQL 14+ compatible (local embedded PG 18, Supabase PG 15+).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_schools_name CHECK (length(btrim(name)) > 0)
);
CREATE TRIGGER trg_schools_updated_at BEFORE UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE campuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(200) NOT NULL,
  address JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_campuses_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_campuses_school_id_id UNIQUE (school_id, id)
);
CREATE TRIGGER trg_campuses_updated_at BEFORE UPDATE ON campuses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  campus_id UUID,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_departments_campus_same_school
    FOREIGN KEY (school_id, campus_id) REFERENCES campuses(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_departments_school_code UNIQUE (school_id, code)
);
CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Identity is global; school access is granted through role assignments.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320),
  phone VARCHAR(40),
  display_name VARCHAR(200) NOT NULL,
  password_hash TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'locked', 'disabled')),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_users_identity CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT chk_users_display_name CHECK (length(btrim(display_name)) > 0)
);
CREATE UNIQUE INDEX uq_users_email_ci ON users (lower(email)) WHERE email IS NOT NULL;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  privileged_flag BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  scope_type VARCHAR(30) NOT NULL
    CHECK (scope_type IN ('school', 'campus', 'department', 'class', 'section', 'self', 'linked_student', 'custom')),
  scope_id UUID,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  granted_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_assignment_dates CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT chk_assignment_scope CHECK (
    (scope_type IN ('school', 'self', 'linked_student') AND scope_id IS NULL)
    OR (scope_type IN ('campus', 'department', 'class', 'section', 'custom') AND scope_id IS NOT NULL)
  )
);
CREATE INDEX ix_role_assignments_user_active
  ON user_role_assignments (user_id, school_id, valid_from, valid_to)
  WHERE revoked_at IS NULL;
CREATE INDEX ix_role_assignments_school_scope
  ON user_role_assignments (school_id, scope_type, scope_id);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip INET,
  user_agent TEXT,
  CONSTRAINT chk_sessions_expiry CHECK (expires_at > created_at)
);
CREATE INDEX ix_sessions_user ON sessions (user_id, expires_at DESC);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  actor_type VARCHAR(30) NOT NULL DEFAULT 'user'
    CHECK (actor_type IN ('user', 'system', 'integration')),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  outcome VARCHAR(30) NOT NULL CHECK (outcome IN ('success', 'denied', 'failure', 'system')),
  reason TEXT,
  correlation_id UUID,
  before_state JSONB,
  after_state JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_ip INET,
  user_agent TEXT
);
CREATE INDEX ix_audit_events_scope_time ON audit_events (school_id, occurred_at DESC);
CREATE INDEX ix_audit_events_entity ON audit_events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX ix_audit_events_actor ON audit_events (actor_user_id, occurred_at DESC);

CREATE TABLE activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_activity_entity_time
  ON activity_events (school_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX ix_activity_school_time
  ON activity_events (school_id, occurred_at DESC);

-- Audit history is append-only. Corrections are new events, never edits.
CREATE OR REPLACE FUNCTION forbid_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit and activity history is append-only';
END;
$$;

CREATE TRIGGER trg_audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER trg_activity_events_immutable
  BEFORE UPDATE OR DELETE ON activity_events
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();


-- ----------------------------------------------------------------------------
-- Migration: 0002_academic.sql (SHA-256: 1106f6b2e92df09d0888618456f258356994fdf4b0bc281cae2bde0d0a6a5e72)
-- ----------------------------------------------------------------------------

-- 0002 Academic structure: years, terms, classes, sections, subjects.

CREATE TABLE academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'active', 'closed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_academic_years_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_academic_years_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_academic_years_dates CHECK (ends_on >= starts_on)
);
CREATE TRIGGER trg_academic_years_updated_at BEFORE UPDATE ON academic_years
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- At most one active academic year per school. Activation happens in a
-- transaction that first closes the previous year.
CREATE UNIQUE INDEX uq_academic_years_one_active
  ON academic_years (school_id) WHERE status = 'active';

CREATE TABLE terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_terms_year_code UNIQUE (academic_year_id, code),
  CONSTRAINT uq_terms_year_sequence UNIQUE (academic_year_id, sequence_no),
  CONSTRAINT chk_terms_dates CHECK (ends_on >= starts_on),
  CONSTRAINT fk_terms_year_same_school
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT
);

CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  grade_order INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_classes_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_classes_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_classes_grade_order CHECK (grade_order IS NULL OR grade_order >= 0)
);
CREATE TRIGGER trg_classes_updated_at BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL,
  class_id UUID NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  capacity INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_sections_year_class_code UNIQUE (academic_year_id, class_id, code),
  CONSTRAINT uq_sections_school_id_id UNIQUE (school_id, id),
  CONSTRAINT uq_sections_scope UNIQUE (school_id, academic_year_id, class_id, id),
  CONSTRAINT chk_sections_capacity CHECK (capacity IS NULL OR capacity >= 0),
  CONSTRAINT fk_sections_year_same_school
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sections_class_same_school
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER trg_sections_updated_at BEFORE UPDATE ON sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_sections_year_class ON sections (school_id, academic_year_id, class_id, status);

CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  subject_type VARCHAR(30) NOT NULL DEFAULT 'academic',
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_subjects_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_subjects_school_id_id UNIQUE (school_id, id)
);
CREATE TRIGGER trg_subjects_updated_at BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ----------------------------------------------------------------------------
-- Migration: 0003_students.sql (SHA-256: 639416fa8654d67ffea2229a34b5c377748e12932e9e7aeac1ab5525d487f318)
-- ----------------------------------------------------------------------------

-- 0003 Students, guardians, admissions and enrollments.

-- Per-school monotonic counters (admission numbers, receipt numbers later).
CREATE TABLE school_counters (
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name VARCHAR(60) NOT NULL,
  value BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0),
  PRIMARY KEY (school_id, name)
);

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  admission_number VARCHAR(60) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100),
  date_of_birth DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'applicant'
    CHECK (status IN ('applicant', 'active', 'withdrawn', 'graduated', 'transferred', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_students_school_admission UNIQUE (school_id, admission_number),
  CONSTRAINT uq_students_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_students_admission CHECK (length(btrim(admission_number)) > 0),
  CONSTRAINT chk_students_names CHECK (length(btrim(first_name)) > 0)
);
CREATE TRIGGER trg_students_updated_at BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_students_school_status ON students (school_id, status, admission_number);
CREATE INDEX ix_students_school_name ON students (school_id, lower(last_name), lower(first_name));

CREATE TABLE guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100),
  email VARCHAR(320),
  phone VARCHAR(40),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'unverified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_guardians_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_guardians_contact CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT chk_guardians_name CHECK (length(btrim(first_name)) > 0)
);
CREATE TRIGGER trg_guardians_updated_at BEFORE UPDATE ON guardians
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_guardians_school_email ON guardians (school_id, lower(email));
CREATE INDEX ix_guardians_user ON guardians (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE student_guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  guardian_id UUID NOT NULL,
  relationship_type VARCHAR(40) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  portal_access_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (portal_access_status IN ('pending', 'verified', 'revoked')),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_guardians_pair UNIQUE (student_id, guardian_id),
  CONSTRAINT fk_student_guardians_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_guardians_guardian
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_student_guardians_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX ix_student_guardians_guardian
  ON student_guardians (guardian_id, portal_access_status);
CREATE INDEX ix_student_guardians_school_student
  ON student_guardians (school_id, student_id);

CREATE TABLE enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  class_id UUID NOT NULL,
  section_id UUID NOT NULL,
  enrollment_status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (enrollment_status IN ('active', 'completed', 'transferred', 'withdrawn', 'cancelled')),
  starts_on DATE NOT NULL,
  ends_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_enrollments_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_enrollments_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_enrollments_section_same_year
    FOREIGN KEY (school_id, academic_year_id, class_id, section_id)
    REFERENCES sections(school_id, academic_year_id, class_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_enrollments_dates CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE TRIGGER trg_enrollments_updated_at BEFORE UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A student may be actively enrolled only once per academic year.
CREATE UNIQUE INDEX uq_enrollments_one_active_student_year
  ON enrollments (student_id, academic_year_id) WHERE enrollment_status = 'active';
CREATE INDEX ix_enrollments_school_section
  ON enrollments (school_id, section_id, enrollment_status);
CREATE INDEX ix_enrollments_school_student
  ON enrollments (school_id, student_id, academic_year_id);

-- Student attendance supports the next vertical slice; structure lands now so
-- section-based authorization can be built against it.
CREATE TABLE student_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  attendance_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('present', 'absent', 'late', 'half_day', 'excused', 'pending_review')),
  source VARCHAR(30) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'import', 'device', 'correction')),
  recorded_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_student_attendance_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_attendance_enrollment_date UNIQUE (enrollment_id, attendance_date)
);
CREATE TRIGGER trg_student_attendance_updated_at BEFORE UPDATE ON student_attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_student_attendance_school_date
  ON student_attendance (school_id, attendance_date, status);

-- Unique key required by section-scoped foreign keys below.
ALTER TABLE sections
  ADD CONSTRAINT uq_sections_school_year_id UNIQUE (school_id, academic_year_id, id);

-- Teaching assignments drive teacher record scope. Populated in the academic
-- assignment slice; declared now so scope checks can be written against it.
CREATE TABLE teaching_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL,
  section_id UUID NOT NULL,
  subject_id UUID,
  role VARCHAR(30) NOT NULL DEFAULT 'subject_teacher'
    CHECK (role IN ('class_teacher', 'subject_teacher')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  CONSTRAINT uq_teaching_assignment UNIQUE (user_id, section_id, subject_id, role),
  CONSTRAINT fk_teaching_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_teaching_section
    FOREIGN KEY (school_id, academic_year_id, section_id)
    REFERENCES sections(school_id, academic_year_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_teaching_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_teaching_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX ix_teaching_user_section ON teaching_assignments (school_id, user_id, section_id);


-- ----------------------------------------------------------------------------
-- Migration: 0004_integrity.sql (SHA-256: 2b5b7dc63ced89f55e6334e71877d62b30f0e3d01552dca0c992ba8dc2bc549e)
-- ----------------------------------------------------------------------------

-- 0004 Reference-data integrity and authorization indexes.

-- A user cannot hold the same active grant twice for the same scope.
CREATE UNIQUE INDEX uq_role_assignments_active
  ON user_role_assignments (
    user_id,
    role_id,
    school_id,
    scope_type,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE revoked_at IS NULL;

-- Guardians with a portal account must resolve to exactly one guardian record
-- per school. Identity is global, so a person may be a guardian at two schools.
CREATE UNIQUE INDEX uq_guardians_school_user
  ON guardians (school_id, user_id)
  WHERE user_id IS NOT NULL;

-- Fast, safe lookup of a parent's linked children.
CREATE INDEX ix_student_guardians_verified
  ON student_guardians (school_id, guardian_id)
  WHERE portal_access_status = 'verified' AND valid_to IS NULL;

-- At most one current primary guardian per student.
CREATE UNIQUE INDEX uq_student_guardians_one_primary
  ON student_guardians (student_id)
  WHERE is_primary AND valid_to IS NULL;


-- ----------------------------------------------------------------------------
-- Migration: 0005_attendance.sql (SHA-256: 2f8bc5b5ab422295c4bc85e3eacff4ad4da476f57d5c5e6d4921c25d5fd80ee3)
-- ----------------------------------------------------------------------------

-- 0005 Attendance corrections.
--
-- Daily attendance rows live in student_attendance (migration 0003). Once a
-- register row exists it is only changed through a correction request that a
-- different user reviews. The original status therefore stays intact until an
-- approval commits, which keeps the evidence trail honest.

-- Composite key so attendance corrections cannot link across schools.
ALTER TABLE student_attendance
  ADD CONSTRAINT uq_student_attendance_school_id_id UNIQUE (school_id, id);

CREATE TABLE attendance_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  attendance_id UUID NOT NULL,
  requested_status VARCHAR(20) NOT NULL
    CHECK (requested_status IN ('present', 'absent', 'late', 'half_day', 'excused')),
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  CONSTRAINT fk_attendance_corrections_attendance
    FOREIGN KEY (school_id, attendance_id)
    REFERENCES student_attendance(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_attendance_correction_reason
    CHECK (length(btrim(reason)) >= 5),
  CONSTRAINT chk_attendance_correction_review
    CHECK (
      (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
      OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

-- At most one pending correction per attendance row. Reviewed corrections are
-- kept forever, so the history is append-only at the workflow level.
CREATE UNIQUE INDEX uq_attendance_corrections_pending
  ON attendance_corrections (attendance_id) WHERE status = 'pending';
CREATE INDEX ix_attendance_corrections_school_status
  ON attendance_corrections (school_id, status, requested_at);
CREATE INDEX ix_attendance_corrections_requester
  ON attendance_corrections (requested_by, requested_at DESC);


-- ----------------------------------------------------------------------------
-- Migration: 0006_timetable.sql (SHA-256: 182628f322b6ca4b2839ea789ef731c82fd7cc6c54fc69c0c68b7fc110e7f456)
-- ----------------------------------------------------------------------------

-- 0006 Timetable: periods, rooms and section slots.
--
-- A slot is one subject taught by one teacher in one room during one period on
-- one weekday. Section, teacher and room double-booking are prevented by unique
-- indexes, so conflicts cannot be committed even if two requests race.

CREATE TABLE timetable_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL,
  name VARCHAR(60) NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  is_break BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_timetable_periods_year_sequence UNIQUE (academic_year_id, sequence_no),
  CONSTRAINT uq_timetable_periods_school_id_id UNIQUE (school_id, id),
  CONSTRAINT uq_timetable_periods_school_year_id UNIQUE (school_id, academic_year_id, id),
  CONSTRAINT chk_timetable_periods_time CHECK (ends_at > starts_at),
  CONSTRAINT fk_timetable_periods_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER trg_timetable_periods_updated_at BEFORE UPDATE ON timetable_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_rooms_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_rooms_school_id_id UNIQUE (school_id, id)
);
CREATE TRIGGER trg_rooms_updated_at BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE timetable_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL,
  section_id UUID NOT NULL,
  period_id UUID NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  subject_id UUID NOT NULL,
  teacher_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  room_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_timetable_slots_section_cell UNIQUE (section_id, day_of_week, period_id),
  CONSTRAINT uq_timetable_slots_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_timetable_slots_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_timetable_slots_section
    FOREIGN KEY (school_id, academic_year_id, section_id)
    REFERENCES sections(school_id, academic_year_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_timetable_slots_period
    FOREIGN KEY (school_id, academic_year_id, period_id)
    REFERENCES timetable_periods(school_id, academic_year_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_timetable_slots_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_timetable_slots_room
    FOREIGN KEY (school_id, room_id) REFERENCES rooms(school_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER trg_timetable_slots_updated_at BEFORE UPDATE ON timetable_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One teacher and one room cannot be in two places at the same time.
CREATE UNIQUE INDEX uq_timetable_slots_teacher
  ON timetable_slots (academic_year_id, day_of_week, period_id, teacher_user_id);
CREATE UNIQUE INDEX uq_timetable_slots_room
  ON timetable_slots (academic_year_id, day_of_week, period_id, room_id)
  WHERE room_id IS NOT NULL;
CREATE INDEX ix_timetable_slots_school_section
  ON timetable_slots (school_id, section_id, day_of_week, period_id);
CREATE INDEX ix_timetable_slots_teacher_lookup
  ON timetable_slots (school_id, teacher_user_id, academic_year_id);


-- ----------------------------------------------------------------------------
-- Migration: 0007_fees.sql (SHA-256: e68061c303c14c009c3d468d009371b29ecb77b8db26dc30f5dc6ddd1186b315)
-- ----------------------------------------------------------------------------

-- 0007 Fees: heads, class-wise structures, student charges, payments and refunds.
--
-- Money is NUMERIC(12,2) throughout; no floating point. A charge's balance is
-- always derived from recorded payments minus approved refunds, so stored
-- status cannot drift from the ledger.

CREATE TABLE fee_heads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_fee_heads_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_fee_heads_school_id_id UNIQUE (school_id, id)
);
CREATE TRIGGER trg_fee_heads_updated_at BEFORE UPDATE ON fee_heads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fee_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL,
  class_id UUID NOT NULL,
  fee_head_id UUID NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  due_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_fee_structures_year_class_head UNIQUE (academic_year_id, class_id, fee_head_id),
  CONSTRAINT uq_fee_structures_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_fee_structures_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fee_structures_class
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fee_structures_head
    FOREIGN KEY (school_id, fee_head_id) REFERENCES fee_heads(school_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER trg_fee_structures_updated_at BEFORE UPDATE ON fee_structures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE student_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  fee_head_id UUID NOT NULL,
  description VARCHAR(200) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  concession_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (concession_amount >= 0),
  concession_reason TEXT,
  due_on DATE NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_charges_student_year_head UNIQUE (student_id, academic_year_id, fee_head_id),
  CONSTRAINT uq_student_charges_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_student_charges_concession CHECK (concession_amount <= amount),
  CONSTRAINT fk_student_charges_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_charges_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_charges_head
    FOREIGN KEY (school_id, fee_head_id) REFERENCES fee_heads(school_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER trg_student_charges_updated_at BEFORE UPDATE ON student_charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_student_charges_school_student
  ON student_charges (school_id, student_id, academic_year_id);
CREATE INDEX ix_student_charges_year_due
  ON student_charges (school_id, academic_year_id, due_on);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  receipt_number VARCHAR(40) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  method VARCHAR(30) NOT NULL
    CHECK (method IN ('cash', 'bank_transfer', 'card', 'upi', 'cheque', 'other')),
  reference VARCHAR(120),
  paid_on DATE NOT NULL,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'reversed')),
  recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_payments_school_receipt UNIQUE (school_id, receipt_number),
  CONSTRAINT uq_payments_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_payments_reversal CHECK (
    (status = 'recorded' AND reversed_by IS NULL AND reversed_at IS NULL)
    OR (status = 'reversed' AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL)
  ),
  CONSTRAINT fk_payments_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payments_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT
);
CREATE INDEX ix_payments_school_student ON payments (school_id, student_id, paid_on DESC);
CREATE INDEX ix_payments_school_status ON payments (school_id, status, paid_on DESC);

CREATE TABLE payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL,
  charge_id UUID NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_allocations_pair UNIQUE (payment_id, charge_id),
  CONSTRAINT fk_payment_allocations_payment
    FOREIGN KEY (school_id, payment_id) REFERENCES payments(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_allocations_charge
    FOREIGN KEY (school_id, charge_id) REFERENCES student_charges(school_id, id) ON DELETE RESTRICT
);
CREATE INDEX ix_payment_allocations_charge ON payment_allocations (charge_id);

CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  CONSTRAINT chk_refunds_reason CHECK (length(btrim(reason)) >= 5),
  CONSTRAINT chk_refunds_review CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT fk_refunds_payment
    FOREIGN KEY (school_id, payment_id) REFERENCES payments(school_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX uq_refunds_pending_payment
  ON refunds (payment_id) WHERE status = 'pending';
CREATE INDEX ix_refunds_school_status ON refunds (school_id, status, requested_at);


-- ----------------------------------------------------------------------------
-- Migration: 0008_exams.sql (SHA-256: 18c72661108f4085c05d380fcd40b4ae1fca2c2fdeab5301d807508c213807ab)
-- ----------------------------------------------------------------------------

-- 0008 Examinations: configurable grading, exams, subjects and marks.
--
-- Grading bands are data, not code. The seed proposes a common Indian
-- 8-point band set, but a school can edit it; nothing in the schema assumes it.
-- Results become visible to guardians only after an authorized user publishes
-- the exam.

CREATE TABLE grading_schemes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_grading_schemes_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_grading_schemes_school_id_id UNIQUE (school_id, id)
);
CREATE UNIQUE INDEX uq_grading_schemes_one_default
  ON grading_schemes (school_id) WHERE is_default;
CREATE TRIGGER trg_grading_schemes_updated_at BEFORE UPDATE ON grading_schemes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE grading_bands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  scheme_id UUID NOT NULL,
  min_percent NUMERIC(5, 2) NOT NULL CHECK (min_percent >= 0 AND min_percent <= 100),
  max_percent NUMERIC(5, 2) NOT NULL CHECK (max_percent >= 0 AND max_percent <= 100),
  grade VARCHAR(10) NOT NULL,
  remark VARCHAR(120),
  CONSTRAINT chk_grading_bands_range CHECK (max_percent >= min_percent),
  CONSTRAINT uq_grading_bands_scheme_grade UNIQUE (scheme_id, grade),
  CONSTRAINT fk_grading_bands_scheme
    FOREIGN KEY (school_id, scheme_id) REFERENCES grading_schemes(school_id, id) ON DELETE RESTRICT
);

CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL,
  name VARCHAR(120) NOT NULL,
  exam_type VARCHAR(40) NOT NULL DEFAULT 'term',
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  grading_scheme_id UUID NOT NULL,
  pass_percent NUMERIC(5, 2) NOT NULL DEFAULT 35 CHECK (pass_percent >= 0 AND pass_percent <= 100),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_exams_year_name UNIQUE (academic_year_id, name),
  CONSTRAINT uq_exams_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_exams_dates CHECK (ends_on >= starts_on),
  CONSTRAINT chk_exams_published CHECK (
    (status = 'draft' AND published_at IS NULL AND published_by IS NULL)
    OR (status = 'published' AND published_at IS NOT NULL AND published_by IS NOT NULL)
  ),
  CONSTRAINT fk_exams_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_exams_scheme
    FOREIGN KEY (school_id, grading_scheme_id) REFERENCES grading_schemes(school_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER trg_exams_updated_at BEFORE UPDATE ON exams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE exam_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  exam_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  max_marks NUMERIC(6, 2) NOT NULL CHECK (max_marks > 0),
  pass_marks NUMERIC(6, 2) NOT NULL DEFAULT 0 CHECK (pass_marks >= 0),
  CONSTRAINT uq_exam_subjects_pair UNIQUE (exam_id, subject_id),
  CONSTRAINT uq_exam_subjects_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_exam_subjects_pass CHECK (pass_marks <= max_marks),
  CONSTRAINT fk_exam_subjects_exam
    FOREIGN KEY (school_id, exam_id) REFERENCES exams(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_exam_subjects_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT
);

CREATE TABLE exam_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  exam_subject_id UUID NOT NULL,
  student_id UUID NOT NULL,
  marks_obtained NUMERIC(6, 2) CHECK (marks_obtained IS NULL OR marks_obtained >= 0),
  is_absent BOOLEAN NOT NULL DEFAULT false,
  entered_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_exam_marks_student_subject UNIQUE (exam_subject_id, student_id),
  CONSTRAINT uq_exam_marks_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_exam_marks_value CHECK (
    (is_absent AND marks_obtained IS NULL)
    OR (NOT is_absent AND marks_obtained IS NOT NULL)
  ),
  CONSTRAINT fk_exam_marks_exam_subject
    FOREIGN KEY (school_id, exam_subject_id) REFERENCES exam_subjects(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_exam_marks_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER trg_exam_marks_updated_at BEFORE UPDATE ON exam_marks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_exam_marks_school_student ON exam_marks (school_id, student_id);


-- ----------------------------------------------------------------------------
-- Migration: 0009_staff.sql (SHA-256: 4e15291dc3854f661af35e1dbea69ca0f6635f9ec6193f25ae03d37e0d43e88b)
-- ----------------------------------------------------------------------------

-- 0009 Staff records, salary (separately gated) and leave requests.

CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  employee_number VARCHAR(40) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100),
  email VARCHAR(320),
  phone VARCHAR(40),
  designation VARCHAR(120) NOT NULL,
  department VARCHAR(120),
  joined_on DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'on_leave', 'inactive', 'left')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_school_employee UNIQUE (school_id, employee_number),
  CONSTRAINT uq_staff_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_staff_name CHECK (length(btrim(first_name)) > 0)
);
CREATE UNIQUE INDEX uq_staff_school_user ON staff (school_id, user_id) WHERE user_id IS NOT NULL;
CREATE TRIGGER trg_staff_updated_at BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Salary lives in its own table so list queries never join it accidentally.
CREATE TABLE staff_salaries (
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  effective_from DATE NOT NULL,
  notes TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, staff_id),
  CONSTRAINT fk_staff_salaries_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT
);

CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  leave_type VARCHAR(40) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  CONSTRAINT uq_leave_requests_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_leave_requests_dates CHECK (ends_on >= starts_on),
  CONSTRAINT chk_leave_requests_reason CHECK (length(btrim(reason)) >= 5),
  CONSTRAINT chk_leave_requests_review CHECK (
    (status IN ('pending', 'cancelled') AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT fk_leave_requests_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT
);
CREATE INDEX ix_leave_requests_school_status ON leave_requests (school_id, status, starts_on);
CREATE INDEX ix_leave_requests_staff ON leave_requests (school_id, staff_id, starts_on DESC);


-- ----------------------------------------------------------------------------
-- Migration: 0010_notices.sql (SHA-256: 6b22240a509a04b81e1e0819a122a2be489320c5fdee263543ad2159ae80fe76)
-- ----------------------------------------------------------------------------

-- 0010 Notices and announcements.

CREATE TABLE notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  audience VARCHAR(20) NOT NULL DEFAULT 'all'
    CHECK (audience IN ('all', 'staff', 'parents', 'students')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  pinned BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  expires_on DATE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notices_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_notices_body CHECK (length(btrim(body)) >= 5),
  CONSTRAINT chk_notices_published CHECK (
    (status = 'draft' AND published_at IS NULL)
    OR (status IN ('published', 'archived') AND published_at IS NOT NULL)
  )
);
CREATE TRIGGER trg_notices_updated_at BEFORE UPDATE ON notices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_notices_school_published
  ON notices (school_id, status, published_at DESC);


-- ----------------------------------------------------------------------------
-- Migration: 0011_notice_files.sql (SHA-256: de671cd0a2cce1e8ace6d7be60e130d0a7620e9f9b501d0defa7e525df824903)
-- ----------------------------------------------------------------------------

-- 0011 Notice attachments and per-user read receipts.

CREATE TABLE notice_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  notice_id UUID NOT NULL,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(120) NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 1048576),
  data BYTEA NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notice_attachments_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_notice_attachments_notice
    FOREIGN KEY (school_id, notice_id) REFERENCES notices(school_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_notice_attachments_filename CHECK (length(btrim(filename)) > 0)
);
CREATE INDEX ix_notice_attachments_notice
  ON notice_attachments (school_id, notice_id, created_at);

CREATE TABLE notice_receipts (
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  notice_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, notice_id, user_id),
  CONSTRAINT fk_notice_receipts_notice
    FOREIGN KEY (school_id, notice_id) REFERENCES notices(school_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_notice_receipts_school_user
  ON notice_receipts (school_id, user_id, read_at DESC);


-- ----------------------------------------------------------------------------
-- Migration: 0012_safeguarding.sql (SHA-256: bd598c4625069783d60ab962c1358574b915aaf47138e6e5b721b8cc3abe6362)
-- ----------------------------------------------------------------------------

-- 0012 Safeguarding cases and restricted notes.
--
-- Access is gated by `safeguarding.case.view`; notes are never exposed through
-- generic student queries and every mutation is audited without copying note
-- text into the audit payload.

CREATE TABLE safeguarding_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  reference VARCHAR(32) NOT NULL,
  category VARCHAR(40) NOT NULL
    CHECK (category IN ('safeguarding', 'attendance', 'wellbeing', 'medical', 'behaviour', 'other')),
  severity VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  summary TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'monitoring', 'closed')),
  opened_on DATE NOT NULL DEFAULT current_date,
  closed_on DATE,
  opened_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_safeguarding_cases_school_ref UNIQUE (school_id, reference),
  CONSTRAINT uq_safeguarding_cases_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_safeguarding_cases_summary CHECK (length(btrim(summary)) >= 10),
  CONSTRAINT chk_safeguarding_cases_closed CHECK (
    (status = 'closed' AND closed_on IS NOT NULL)
    OR (status <> 'closed')
  ),
  CONSTRAINT fk_safeguarding_cases_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER trg_safeguarding_cases_updated_at BEFORE UPDATE ON safeguarding_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_safeguarding_cases_school_status
  ON safeguarding_cases (school_id, status, opened_on DESC);

CREATE TABLE safeguarding_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL,
  note TEXT NOT NULL,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_safeguarding_notes_note CHECK (length(btrim(note)) >= 1),
  CONSTRAINT fk_safeguarding_notes_case
    FOREIGN KEY (school_id, case_id) REFERENCES safeguarding_cases(school_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_safeguarding_notes_case
  ON safeguarding_notes (school_id, case_id, created_at);


-- ----------------------------------------------------------------------------
-- Migration: 0013_leave_config.sql (SHA-256: f573c49f56fd10e37e7055d2f5868435b054ce21f893a969e33d8acb2152c16d)
-- ----------------------------------------------------------------------------

-- 0013 Leave types, holiday calendar and per-type balances.
--
-- Leave types are configuration, not code. Balances are derived from approved
-- requests in the selected calendar year; nothing is pre-aggregated.

CREATE TABLE leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  annual_quota_days NUMERIC(5, 1) NOT NULL DEFAULT 0 CHECK (annual_quota_days >= 0),
  paid BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_leave_types_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_leave_types_school_id_id UNIQUE (school_id, id)
);
CREATE TRIGGER trg_leave_types_updated_at BEFORE UPDATE ON leave_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  holiday_on DATE NOT NULL,
  academic_year_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_holidays_school_date_name UNIQUE (school_id, holiday_on, name),
  CONSTRAINT uq_holidays_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_holidays_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER trg_holidays_updated_at BEFORE UPDATE ON holidays
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_holidays_school_date ON holidays (school_id, holiday_on);


-- ----------------------------------------------------------------------------
-- Migration: 0014_payroll.sql (SHA-256: dcccb104072d78293a24dd707061676c5ba15d789e8c036d762f1af734e873ef)
-- ----------------------------------------------------------------------------

-- 0014 Payroll runs and payslips.
--
-- Amounts live only in these tables and are read through the salary-sensitive
-- permission. A run is approved by a different user from the one who created
-- it; the audit trail records counts, never amounts.

CREATE TABLE payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'paid')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  paid_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_runs_school_period UNIQUE (school_id, period_start, period_end),
  CONSTRAINT uq_payroll_runs_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_payroll_runs_dates CHECK (period_end >= period_start),
  CONSTRAINT chk_payroll_runs_approval CHECK (
    (status = 'draft' AND approved_by IS NULL AND approved_at IS NULL)
    OR (status IN ('approved', 'paid') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CONSTRAINT chk_payroll_runs_paid CHECK (
    (status = 'paid' AND paid_on IS NOT NULL) OR (status <> 'paid')
  )
);
CREATE TRIGGER trg_payroll_runs_updated_at BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  run_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  gross_amount NUMERIC(12, 2) NOT NULL CHECK (gross_amount >= 0),
  deductions NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  net_amount NUMERIC(12, 2) NOT NULL CHECK (net_amount >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_payslips_run_staff UNIQUE (school_id, run_id, staff_id),
  CONSTRAINT uq_payslips_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_payslips_net CHECK (net_amount = gross_amount - deductions),
  CONSTRAINT fk_payslips_run
    FOREIGN KEY (school_id, run_id) REFERENCES payroll_runs(school_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_payslips_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT
);
CREATE INDEX ix_payslips_school_staff ON payslips (school_id, staff_id);


-- ----------------------------------------------------------------------------
-- Migration: 0015_fee_plans.sql (SHA-256: 143ef0c3a2718141a20181074f69b913656feaba4bc7dbff1dded75de0f82e7d)
-- ----------------------------------------------------------------------------

-- 0015 Fee late-fee rules, assessment log and instalment schedules.
--
-- Late fees are posted to a dedicated LATE-FEE head so the ordinary ledger
-- stays intact. Assessments are unique per charge per day, which makes a
-- re-run idempotent for the same day. Instalment schedules are derived views
-- of a charge; allocations remain charge-level.

CREATE TABLE fee_late_fee_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  grace_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_days >= 0 AND grace_days <= 365),
  percent_per_month NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (percent_per_month >= 0 AND percent_per_month <= 100),
  max_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (max_amount >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_fee_late_fee_rules_school_id_id UNIQUE (school_id, id)
);
CREATE TRIGGER trg_fee_late_fee_rules_updated_at BEFORE UPDATE ON fee_late_fee_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE late_fee_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  charge_id UUID NOT NULL,
  rule_id UUID NOT NULL,
  assessed_on DATE NOT NULL,
  base_amount NUMERIC(12, 2) NOT NULL CHECK (base_amount >= 0),
  fee_amount NUMERIC(12, 2) NOT NULL CHECK (fee_amount >= 0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_late_fee_assessments_charge_day UNIQUE (school_id, charge_id, assessed_on),
  CONSTRAINT fk_late_fee_assessments_charge
    FOREIGN KEY (school_id, charge_id) REFERENCES student_charges(school_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_late_fee_assessments_rule
    FOREIGN KEY (school_id, rule_id) REFERENCES fee_late_fee_rules(school_id, id) ON DELETE RESTRICT
);
CREATE INDEX ix_late_fee_assessments_school_day
  ON late_fee_assessments (school_id, assessed_on DESC);

CREATE TABLE fee_installment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  structure_id UUID NOT NULL,
  sequence SMALLINT NOT NULL CHECK (sequence > 0),
  label VARCHAR(80) NOT NULL,
  percent NUMERIC(5, 2) NOT NULL CHECK (percent > 0 AND percent <= 100),
  due_on DATE NOT NULL,
  CONSTRAINT uq_fee_installment_plans_structure_seq UNIQUE (school_id, structure_id, sequence),
  CONSTRAINT uq_fee_installment_plans_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_fee_installment_plans_structure
    FOREIGN KEY (school_id, structure_id) REFERENCES fee_structures(school_id, id) ON DELETE CASCADE
);


-- ----------------------------------------------------------------------------
-- Migration: 0016_auth_security.sql (SHA-256: aa2f19159e07e3babdb8503125bdce85d5b074798882229cc665ef7d164f1938)
-- ----------------------------------------------------------------------------

-- 0016 Password reset tokens and TOTP multi-factor authentication.
--
-- Reset tokens are stored only as SHA-256 hashes. TOTP secrets are stored so
-- the server can verify codes; they are never returned by any read endpoint
-- after setup. Recovery codes are intentionally out of scope for this build.

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  requested_ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_password_reset_tokens_hash UNIQUE (token_hash),
  CONSTRAINT chk_password_reset_tokens_expiry CHECK (expires_at > created_at)
);
CREATE INDEX ix_password_reset_tokens_user
  ON password_reset_tokens (user_id, created_at DESC);

CREATE TABLE user_mfa (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret VARCHAR(64) NOT NULL,
  confirmed_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_user_mfa_updated_at BEFORE UPDATE ON user_mfa
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ----------------------------------------------------------------------------
-- Migration: 0017_idempotency.sql (SHA-256: 47cfe044b83b8c04b32b41cfb7cd9d399dbdf07a879f07382dbb105828bf1d7b)
-- ----------------------------------------------------------------------------

-- 0017 Idempotency keys for money-moving and admission mutations.
--
-- A client supplies `Idempotency-Key`; the first completed response is replayed
-- for the same actor, route and key. Keys expire so the table cannot grow
-- without bound.

CREATE TABLE idempotency_keys (
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(120) NOT NULL,
  route VARCHAR(160) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (school_id, user_id, idempotency_key, route)
);
CREATE INDEX ix_idempotency_keys_expiry ON idempotency_keys (expires_at);


-- ----------------------------------------------------------------------------
-- Migration: 0018_rls.sql (SHA-256: dc3fdbb7efba4664b4598bba64a0b8cbd82432221d2ec72e278a26035045c90e)
-- ----------------------------------------------------------------------------

-- 0018 Row-level security policies (defence in depth).
--
-- The API enforces tenant isolation in every query. These policies add a second
-- layer when the application connects as the restricted `erp_app` role and sets
-- `app.school_id` for the transaction. The default local owner connection is
-- not subject to RLS, so this migration does not change local behaviour; it is
-- a deployment hardening step documented in README.md.

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app NOLOGIN;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping erp_app role creation (insufficient privilege)';
END
$role$;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT USAGE ON SCHEMA public TO erp_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
  END IF;
END
$grants$;

DO $policies$
DECLARE
  tenant_table TEXT;
  policy_expression TEXT :=
    'school_id = nullif(current_setting(''app.school_id'', true), '''')::uuid';
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'academic_years', 'classes', 'sections', 'subjects',
    'students', 'guardians', 'student_guardians', 'enrollments',
    'attendance_records', 'timetable_slots',
    'fee_heads', 'fee_structures', 'student_charges', 'payments',
    'payment_allocations', 'refunds', 'fee_late_fee_rules',
    'late_fee_assessments', 'fee_installment_plans',
    'exams', 'exam_subjects', 'exam_marks',
    'staff', 'staff_salaries', 'leave_requests', 'leave_types', 'holidays',
    'payroll_runs', 'payslips',
    'notices', 'notice_attachments', 'notice_receipts',
    'safeguarding_cases', 'safeguarding_notes',
    'audit_events', 'idempotency_keys'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tenant_table
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tenant_table);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (%s) WITH CHECK (%s)',
        tenant_table, policy_expression, policy_expression
      );
    END IF;
  END LOOP;
END
$policies$;


-- ----------------------------------------------------------------------------
-- Migration: 0019_staff_attendance.sql (SHA-256: 368281a8c9003a74cb112db8f284f6eb46fe2a4a2f404fc2c400a8b4e167120c)
-- ----------------------------------------------------------------------------

-- 0019 Staff attendance and workforce timekeeping.
--
-- Shifts and assignments are configuration; attendance rows are the daily
-- operational record. Late/early/overtime minutes are computed by the API from
-- the assigned shift and the school's provisional grace rule (D-037). A row
-- with only one punch is stored as missing_punch and must go through the
-- correction workflow before payroll can rely on it.

CREATE TABLE staff_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  grace_minutes INTEGER NOT NULL DEFAULT 10
    CHECK (grace_minutes BETWEEN 0 AND 240),
  break_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (break_minutes BETWEEN 0 AND 240),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_shifts_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_staff_shifts_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_staff_shifts_times CHECK (ends_at > starts_at)
);

CREATE TRIGGER trg_staff_shifts_updated_at BEFORE UPDATE ON staff_shifts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE staff_shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  shift_id UUID NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_shift_assignments_school_staff_from
    UNIQUE (school_id, staff_id, effective_from),
  CONSTRAINT uq_staff_shift_assignments_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_staff_shift_assignments_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_staff_shift_assignments_shift
    FOREIGN KEY (school_id, shift_id) REFERENCES staff_shifts(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_staff_shift_assignments_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX idx_staff_shift_assignments_lookup
  ON staff_shift_assignments (school_id, staff_id, effective_from DESC);

CREATE TABLE staff_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  shift_id UUID,
  work_date DATE NOT NULL,
  punch_in TIMESTAMPTZ,
  punch_out TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'present'
    CHECK (status IN ('present', 'late', 'absent', 'half_day', 'leave', 'excused', 'missing_punch')),
  late_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  early_departure_minutes INTEGER NOT NULL DEFAULT 0 CHECK (early_departure_minutes >= 0),
  overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  note TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_attendance_school_staff_date UNIQUE (school_id, staff_id, work_date),
  CONSTRAINT uq_staff_attendance_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_staff_attendance_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_staff_attendance_shift
    FOREIGN KEY (school_id, shift_id) REFERENCES staff_shifts(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_staff_attendance_punches
    CHECK (punch_out IS NULL OR punch_in IS NULL OR punch_out >= punch_in)
);

CREATE TRIGGER trg_staff_attendance_updated_at BEFORE UPDATE ON staff_attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_staff_attendance_date
  ON staff_attendance (school_id, work_date DESC);
CREATE INDEX idx_staff_attendance_staff
  ON staff_attendance (school_id, staff_id, work_date DESC);

CREATE TABLE staff_attendance_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  attendance_id UUID NOT NULL,
  requested_status VARCHAR(20)
    CHECK (requested_status IN ('present', 'late', 'absent', 'half_day', 'leave', 'excused', 'missing_punch')),
  requested_punch_in TIMESTAMPTZ,
  requested_punch_out TIMESTAMPTZ,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  CONSTRAINT uq_staff_attendance_corrections_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_staff_attendance_corrections_attendance
    FOREIGN KEY (school_id, attendance_id) REFERENCES staff_attendance(school_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_staff_attendance_corrections_review
    CHECK (
      (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
      OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_staff_attendance_corrections_pending
  ON staff_attendance_corrections (school_id, attendance_id)
  WHERE status = 'pending';

CREATE INDEX idx_staff_attendance_corrections_status
  ON staff_attendance_corrections (school_id, status, requested_at);

CREATE TABLE staff_attendance_settings (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE RESTRICT,
  full_day_minutes INTEGER NOT NULL DEFAULT 480 CHECK (full_day_minutes BETWEEN 60 AND 1440),
  half_day_minutes INTEGER NOT NULL DEFAULT 240 CHECK (half_day_minutes BETWEEN 0 AND 1440),
  overtime_after_minutes INTEGER NOT NULL DEFAULT 30 CHECK (overtime_after_minutes >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_staff_attendance_settings_thresholds CHECK (half_day_minutes <= full_day_minutes)
);


-- ----------------------------------------------------------------------------
-- Migration: 0020_recruitment.sql (SHA-256: 9ad48b845c9e0d01fd689f929b8a553a8c9770e8dd4ccec281f6f10b541e6c3c)
-- ----------------------------------------------------------------------------

-- 0020 Recruitment, onboarding, employee changes and separation.
--
-- Candidate and offer data is personal and restricted: routes require the
-- recruitment permissions and never copy contact details or salary into the
-- audit trail. An approved offer is the only path that creates a staff record,
-- and the candidate keeps a link to the created employee to prevent duplicates.

CREATE TABLE vacancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  reference VARCHAR(40) NOT NULL,
  title VARCHAR(160) NOT NULL,
  department VARCHAR(120),
  designation VARCHAR(120) NOT NULL,
  employment_type VARCHAR(30) NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'visiting')),
  openings INTEGER NOT NULL DEFAULT 1 CHECK (openings BETWEEN 1 AND 100),
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed', 'cancelled')),
  posted_on DATE,
  closes_on DATE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_vacancies_school_reference UNIQUE (school_id, reference),
  CONSTRAINT uq_vacancies_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_vacancies_dates CHECK (closes_on IS NULL OR posted_on IS NULL OR closes_on >= posted_on)
);

CREATE TRIGGER trg_vacancies_updated_at BEFORE UPDATE ON vacancies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_vacancies_status ON vacancies (school_id, status, posted_on DESC);

CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  vacancy_id UUID NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100),
  email VARCHAR(320) NOT NULL,
  phone VARCHAR(40),
  stage VARCHAR(20) NOT NULL DEFAULT 'applied'
    CHECK (stage IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')),
  source VARCHAR(80),
  notes TEXT,
  applied_on DATE NOT NULL DEFAULT current_date,
  converted_staff_id UUID,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_candidates_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_candidates_vacancy
    FOREIGN KEY (school_id, vacancy_id) REFERENCES vacancies(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_candidates_staff
    FOREIGN KEY (school_id, converted_staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_candidates_converted
    CHECK ((stage = 'hired') = (converted_staff_id IS NOT NULL))
);

CREATE UNIQUE INDEX uq_candidates_vacancy_email
  ON candidates (school_id, vacancy_id, lower(email));
CREATE INDEX idx_candidates_stage ON candidates (school_id, stage, applied_on DESC);

CREATE TRIGGER trg_candidates_updated_at BEFORE UPDATE ON candidates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE candidate_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  candidate_id UUID NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  mode VARCHAR(20) NOT NULL DEFAULT 'in_person'
    CHECK (mode IN ('in_person', 'phone', 'video')),
  interviewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  score INTEGER CHECK (score BETWEEN 1 AND 10),
  recommendation VARCHAR(20)
    CHECK (recommendation IN ('strong_hire', 'hire', 'hold', 'reject')),
  feedback TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_candidate_interviews_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_candidate_interviews_candidate
    FOREIGN KEY (school_id, candidate_id) REFERENCES candidates(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_candidate_interviews_updated_at BEFORE UPDATE ON candidate_interviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_candidate_interviews_schedule
  ON candidate_interviews (school_id, scheduled_at);

CREATE TABLE job_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  candidate_id UUID NOT NULL,
  designation VARCHAR(120) NOT NULL,
  department VARCHAR(120),
  gross_salary NUMERIC(12, 2) NOT NULL CHECK (gross_salary > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  starts_on DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'accepted', 'declined', 'cancelled')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_job_offers_school_id_id UNIQUE (school_id, id),
  CONSTRAINT uq_job_offers_candidate UNIQUE (school_id, candidate_id),
  CONSTRAINT fk_job_offers_candidate
    FOREIGN KEY (school_id, candidate_id) REFERENCES candidates(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_job_offers_approval
    CHECK (
      (status IN ('draft', 'pending_approval', 'cancelled') AND approved_by IS NULL AND approved_at IS NULL)
      OR (status IN ('approved', 'rejected', 'accepted', 'declined') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    )
);

CREATE TRIGGER trg_job_offers_updated_at BEFORE UPDATE ON job_offers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE onboarding_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  title VARCHAR(200) NOT NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  due_on DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'cancelled')),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_onboarding_tasks_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_onboarding_tasks_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_onboarding_tasks_completed
    CHECK ((status = 'done') = (completed_at IS NOT NULL))
);

CREATE INDEX idx_onboarding_tasks_staff ON onboarding_tasks (school_id, staff_id, status);

CREATE TABLE employee_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  change_type VARCHAR(30) NOT NULL
    CHECK (change_type IN ('transfer', 'department', 'designation', 'status')),
  effective_on DATE NOT NULL,
  from_value VARCHAR(200),
  to_value VARCHAR(200) NOT NULL,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_employee_changes_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_employee_changes_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_employee_changes_staff
  ON employee_changes (school_id, staff_id, effective_on DESC);

CREATE TABLE staff_separations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  last_working_day DATE NOT NULL,
  reason VARCHAR(30) NOT NULL
    CHECK (reason IN ('resignation', 'retirement', 'termination', 'contract_end', 'other')),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'approved', 'completed', 'cancelled')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  access_revoked_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_separations_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_staff_separations_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_staff_separations_approval
    CHECK (status IN ('initiated', 'cancelled') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT chk_staff_separations_completion
    CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_staff_separations_open
  ON staff_separations (school_id, staff_id)
  WHERE status IN ('initiated', 'approved');

CREATE TRIGGER trg_staff_separations_updated_at BEFORE UPDATE ON staff_separations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE exit_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  separation_id UUID NOT NULL,
  title VARCHAR(200) NOT NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'cancelled')),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_exit_tasks_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_exit_tasks_separation
    FOREIGN KEY (school_id, separation_id) REFERENCES staff_separations(school_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_exit_tasks_separation ON exit_tasks (school_id, separation_id, status);


-- ----------------------------------------------------------------------------
-- Migration: 0021_procurement.sql (SHA-256: 21a3395799f1c263f411486f4234cb4a46f7213e9de2471e1d0ae1cc553a58ef)
-- ----------------------------------------------------------------------------

-- 0021 Procurement, purchase orders, expenses and budgets.
--
-- Money is stored in NUMERIC and line totals are generated by the database, so
-- a header total can never drift from its items. Approvals are append-only and
-- a requester cannot approve their own request, purchase order or bill.
-- Expenses are the only records that consume a budget; utilisation is derived,
-- never stored as a mutable counter.

CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(200) NOT NULL,
  contact_name VARCHAR(160),
  email VARCHAR(320),
  phone VARCHAR(40),
  address TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'blocked')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_vendors_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_vendors_school_id_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_vendors_updated_at BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE procurement_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  department VARCHAR(120),
  allocated_amount NUMERIC(14, 2) NOT NULL CHECK (allocated_amount >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_procurement_budgets_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_procurement_budgets_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_procurement_budgets_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_procurement_budgets_updated_at BEFORE UPDATE ON procurement_budgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  request_number VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  department VARCHAR(120),
  justification TEXT,
  needed_by DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled', 'converted')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_purchase_requests_school_number UNIQUE (school_id, request_number),
  CONSTRAINT uq_purchase_requests_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_purchase_requests_approval
    CHECK (
      (status IN ('draft', 'submitted', 'cancelled') AND approved_by IS NULL AND approved_at IS NULL)
      OR (status IN ('approved', 'rejected', 'converted') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    )
);

CREATE TRIGGER trg_purchase_requests_updated_at BEFORE UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_purchase_requests_status
  ON purchase_requests (school_id, status, created_at DESC);

CREATE TABLE purchase_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  description VARCHAR(300) NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  estimated_unit_price NUMERIC(14, 2) NOT NULL CHECK (estimated_unit_price >= 0),
  line_total NUMERIC(16, 2) GENERATED ALWAYS AS (quantity * estimated_unit_price) STORED,
  CONSTRAINT uq_purchase_request_items_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_purchase_request_items_request
    FOREIGN KEY (school_id, request_id) REFERENCES purchase_requests(school_id, id) ON DELETE CASCADE
);

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  po_number VARCHAR(40) NOT NULL,
  vendor_id UUID NOT NULL,
  request_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'partially_received', 'received', 'cancelled', 'closed')),
  order_date DATE NOT NULL DEFAULT current_date,
  expected_on DATE,
  total_amount NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_purchase_orders_school_number UNIQUE (school_id, po_number),
  CONSTRAINT uq_purchase_orders_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_purchase_orders_vendor
    FOREIGN KEY (school_id, vendor_id) REFERENCES vendors(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_orders_request
    FOREIGN KEY (school_id, request_id) REFERENCES purchase_requests(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_purchase_orders_dates CHECK (expected_on IS NULL OR expected_on >= order_date)
);

CREATE TRIGGER trg_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  po_id UUID NOT NULL,
  description VARCHAR(300) NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  received_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0
    CHECK (received_quantity >= 0 AND received_quantity <= quantity),
  line_total NUMERIC(16, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  CONSTRAINT uq_purchase_order_items_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_purchase_order_items_order
    FOREIGN KEY (school_id, po_id) REFERENCES purchase_orders(school_id, id) ON DELETE CASCADE
);

CREATE TABLE goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  po_id UUID NOT NULL,
  received_on DATE NOT NULL DEFAULT current_date,
  received_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_goods_receipts_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_goods_receipts_order
    FOREIGN KEY (school_id, po_id) REFERENCES purchase_orders(school_id, id) ON DELETE RESTRICT
);

CREATE TABLE goods_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  receipt_id UUID NOT NULL,
  po_item_id UUID NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  discrepancy_note TEXT,
  CONSTRAINT uq_goods_receipt_items_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_goods_receipt_items_receipt
    FOREIGN KEY (school_id, receipt_id) REFERENCES goods_receipts(school_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_goods_receipt_items_order_item
    FOREIGN KEY (school_id, po_item_id) REFERENCES purchase_order_items(school_id, id) ON DELETE RESTRICT
);

CREATE TABLE vendor_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  vendor_id UUID NOT NULL,
  po_id UUID,
  bill_number VARCHAR(80) NOT NULL,
  bill_date DATE NOT NULL,
  due_on DATE,
  amount NUMERIC(16, 2) NOT NULL CHECK (amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'approved', 'paid', 'void')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  paid_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_vendor_bills_school_vendor_number UNIQUE (school_id, vendor_id, bill_number),
  CONSTRAINT uq_vendor_bills_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_vendor_bills_vendor
    FOREIGN KEY (school_id, vendor_id) REFERENCES vendors(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_vendor_bills_order
    FOREIGN KEY (school_id, po_id) REFERENCES purchase_orders(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_vendor_bills_paid CHECK (status <> 'paid' OR paid_on IS NOT NULL)
);

CREATE TRIGGER trg_vendor_bills_updated_at BEFORE UPDATE ON vendor_bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE procurement_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  budget_id UUID NOT NULL,
  vendor_id UUID,
  po_id UUID,
  bill_id UUID,
  description VARCHAR(300) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  spent_on DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'approved', 'void')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_procurement_expenses_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_procurement_expenses_budget
    FOREIGN KEY (school_id, budget_id) REFERENCES procurement_budgets(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_procurement_expenses_vendor
    FOREIGN KEY (school_id, vendor_id) REFERENCES vendors(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_procurement_expenses_order
    FOREIGN KEY (school_id, po_id) REFERENCES purchase_orders(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_procurement_expenses_bill
    FOREIGN KEY (school_id, bill_id) REFERENCES vendor_bills(school_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_procurement_expenses_budget
  ON procurement_expenses (school_id, budget_id, spent_on);

CREATE TABLE procurement_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  entity_type VARCHAR(30) NOT NULL
    CHECK (entity_type IN ('purchase_request', 'purchase_order', 'vendor_bill')),
  entity_id UUID NOT NULL,
  stage VARCHAR(60) NOT NULL,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note TEXT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_procurement_approvals_school_id_id UNIQUE (school_id, id)
);

CREATE INDEX idx_procurement_approvals_entity
  ON procurement_approvals (school_id, entity_type, entity_id, decided_at);


-- ----------------------------------------------------------------------------
-- Migration: 0022_transport.sql (SHA-256: 31b114c200eb09c0f29f933399d94930751da1ddeb1418caf5d79d353c06a9a0)
-- ----------------------------------------------------------------------------

-- 0022 Transport and fleet management.
--
-- Routes carry an optional link to an existing fee head so transport charges use
-- the fee ledger instead of creating a parallel money table. Capacity is checked
-- inside the allocation transaction against the assigned vehicle. Driver licence
-- and vehicle insurance dates are recorded as supplied by the school; the system
-- does not invent compliance rules or external GPS data.

CREATE TABLE transport_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  registration_number VARCHAR(40) NOT NULL,
  model VARCHAR(120),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 200),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'maintenance', 'retired')),
  insurance_expires_on DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_transport_vehicles_school_registration UNIQUE (school_id, registration_number),
  CONSTRAINT uq_transport_vehicles_school_id_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_transport_vehicles_updated_at BEFORE UPDATE ON transport_vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE transport_drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(40),
  licence_number VARCHAR(80),
  licence_expires_on DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_transport_drivers_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_transport_drivers_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_transport_drivers_updated_at BEFORE UPDATE ON transport_drivers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE transport_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  vehicle_id UUID,
  driver_id UUID,
  attendant_name VARCHAR(160),
  fee_head_id UUID,
  fee_amount NUMERIC(12, 2) CHECK (fee_amount IS NULL OR fee_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_transport_routes_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_transport_routes_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_transport_routes_vehicle
    FOREIGN KEY (school_id, vehicle_id) REFERENCES transport_vehicles(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_transport_routes_driver
    FOREIGN KEY (school_id, driver_id) REFERENCES transport_drivers(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_transport_routes_fee_head
    FOREIGN KEY (school_id, fee_head_id) REFERENCES fee_heads(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_transport_routes_updated_at BEFORE UPDATE ON transport_routes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE transport_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  route_id UUID NOT NULL,
  name VARCHAR(160) NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no BETWEEN 1 AND 100),
  scheduled_pickup TIME,
  scheduled_drop TIME,
  landmark VARCHAR(200),
  CONSTRAINT uq_transport_stops_route_sequence UNIQUE (school_id, route_id, sequence_no),
  CONSTRAINT uq_transport_stops_school_route_id UNIQUE (school_id, route_id, id),
  CONSTRAINT uq_transport_stops_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_transport_stops_route
    FOREIGN KEY (school_id, route_id) REFERENCES transport_routes(school_id, id) ON DELETE CASCADE
);

CREATE TABLE student_transport_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  route_id UUID NOT NULL,
  stop_id UUID NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'ended')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_transport_allocations_school_id_id UNIQUE (school_id, id),
  CONSTRAINT uq_student_transport_allocations_from UNIQUE (school_id, student_id, effective_from),
  CONSTRAINT fk_student_transport_allocations_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_transport_allocations_route
    FOREIGN KEY (school_id, route_id) REFERENCES transport_routes(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_transport_allocations_stop
    FOREIGN KEY (school_id, route_id, stop_id) REFERENCES transport_stops(school_id, route_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_student_transport_allocations_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT chk_student_transport_allocations_status
    CHECK ((status = 'active') = (effective_to IS NULL))
);

CREATE UNIQUE INDEX uq_student_transport_allocations_current
  ON student_transport_allocations (school_id, student_id)
  WHERE effective_to IS NULL;

CREATE INDEX idx_student_transport_allocations_route
  ON student_transport_allocations (school_id, route_id, status);

CREATE TABLE transport_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  vehicle_id UUID NOT NULL,
  performed_on DATE NOT NULL,
  description VARCHAR(300) NOT NULL,
  cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  vendor_name VARCHAR(160),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_transport_maintenance_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_transport_maintenance_vehicle
    FOREIGN KEY (school_id, vehicle_id) REFERENCES transport_vehicles(school_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_transport_maintenance_vehicle
  ON transport_maintenance (school_id, vehicle_id, performed_on DESC);


-- ----------------------------------------------------------------------------
-- Migration: 0023_library.sql (SHA-256: 0e32055cefac25b40fc6ae5a6c9dd446082a86256995bb2e6f5ea0404504c8e0)
-- ----------------------------------------------------------------------------

-- 0023 Library catalogue and circulation.
--
-- A physical copy can only be on one open loan: the partial unique index below
-- makes double issuance impossible even under concurrent requests. Loan and
-- fine parameters live in library_settings so they are explicit school
-- configuration rather than hard-coded policy.

CREATE TABLE library_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  CONSTRAINT uq_library_categories_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_library_categories_school_id_id UNIQUE (school_id, id)
);

CREATE TABLE library_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  category_id UUID,
  title VARCHAR(300) NOT NULL,
  author VARCHAR(200),
  publisher VARCHAR(200),
  isbn VARCHAR(40),
  language VARCHAR(60),
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_library_books_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_library_books_category
    FOREIGN KEY (school_id, category_id) REFERENCES library_categories(school_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_library_books_isbn
  ON library_books (school_id, isbn) WHERE isbn IS NOT NULL;
CREATE INDEX idx_library_books_title ON library_books (school_id, title);

CREATE TRIGGER trg_library_books_updated_at BEFORE UPDATE ON library_books
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE library_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  book_id UUID NOT NULL,
  accession_number VARCHAR(60) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'issued', 'lost', 'damaged', 'retired')),
  acquired_on DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_library_copies_school_accession UNIQUE (school_id, accession_number),
  CONSTRAINT uq_library_copies_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_library_copies_book
    FOREIGN KEY (school_id, book_id) REFERENCES library_books(school_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_library_copies_book ON library_copies (school_id, book_id, status);

CREATE TRIGGER trg_library_copies_updated_at BEFORE UPDATE ON library_copies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE library_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  member_code VARCHAR(60) NOT NULL,
  student_id UUID,
  staff_id UUID,
  borrowing_limit INTEGER NOT NULL CHECK (borrowing_limit BETWEEN 1 AND 50),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'inactive')),
  joined_on DATE NOT NULL DEFAULT current_date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_library_members_school_code UNIQUE (school_id, member_code),
  CONSTRAINT uq_library_members_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_library_members_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_library_members_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_library_members_subject
    CHECK (((student_id IS NOT NULL)::int + (staff_id IS NOT NULL)::int) = 1)
);

CREATE UNIQUE INDEX uq_library_members_student
  ON library_members (school_id, student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX uq_library_members_staff
  ON library_members (school_id, staff_id) WHERE staff_id IS NOT NULL;

CREATE TRIGGER trg_library_members_updated_at BEFORE UPDATE ON library_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE library_settings (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE RESTRICT,
  loan_days INTEGER NOT NULL DEFAULT 14 CHECK (loan_days BETWEEN 1 AND 365),
  fine_per_day NUMERIC(10, 2) NOT NULL DEFAULT 5 CHECK (fine_per_day >= 0),
  max_renewals INTEGER NOT NULL DEFAULT 1 CHECK (max_renewals BETWEEN 0 AND 10),
  default_borrowing_limit INTEGER NOT NULL DEFAULT 3
    CHECK (default_borrowing_limit BETWEEN 1 AND 50),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE library_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  copy_id UUID NOT NULL,
  member_id UUID NOT NULL,
  issued_on DATE NOT NULL DEFAULT current_date,
  due_on DATE NOT NULL,
  returned_on DATE,
  renewed_count INTEGER NOT NULL DEFAULT 0 CHECK (renewed_count >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'returned', 'lost')),
  issued_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  returned_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_library_loans_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_library_loans_copy
    FOREIGN KEY (school_id, copy_id) REFERENCES library_copies(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_library_loans_member
    FOREIGN KEY (school_id, member_id) REFERENCES library_members(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_library_loans_dates CHECK (due_on >= issued_on),
  CONSTRAINT chk_library_loans_returned
    CHECK ((status = 'returned') = (returned_on IS NOT NULL))
);

CREATE UNIQUE INDEX uq_library_loans_open_copy
  ON library_loans (school_id, copy_id) WHERE returned_on IS NULL;

CREATE INDEX idx_library_loans_member ON library_loans (school_id, member_id, issued_on DESC);
CREATE INDEX idx_library_loans_due ON library_loans (school_id, due_on) WHERE returned_on IS NULL;

CREATE TRIGGER trg_library_loans_updated_at BEFORE UPDATE ON library_loans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE library_fines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  loan_id UUID NOT NULL,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  reason VARCHAR(40) NOT NULL
    CHECK (reason IN ('overdue', 'lost', 'damaged')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'waived')),
  assessed_on DATE NOT NULL DEFAULT current_date,
  paid_on DATE,
  recorded_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_library_fines_school_id_id UNIQUE (school_id, id),
  CONSTRAINT uq_library_fines_loan UNIQUE (school_id, loan_id),
  CONSTRAINT fk_library_fines_loan
    FOREIGN KEY (school_id, loan_id) REFERENCES library_loans(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_library_fines_paid CHECK (status <> 'paid' OR paid_on IS NOT NULL)
);

CREATE TABLE library_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  book_id UUID NOT NULL,
  member_id UUID NOT NULL,
  reserved_on DATE NOT NULL DEFAULT current_date,
  expires_on DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'fulfilled', 'cancelled', 'expired')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_library_reservations_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_library_reservations_book
    FOREIGN KEY (school_id, book_id) REFERENCES library_books(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_library_reservations_member
    FOREIGN KEY (school_id, member_id) REFERENCES library_members(school_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_library_reservations_open
  ON library_reservations (school_id, book_id, member_id)
  WHERE status IN ('pending', 'ready');


-- ----------------------------------------------------------------------------
-- Migration: 0024_learning.sql (SHA-256: aec3b009bbe79e4f17d6d245ea4fa430cc07c3f0ecfe52dac59169eb76958601)
-- ----------------------------------------------------------------------------

-- 0024 Learning resources, homework, submissions and question bank.
--
-- Resource and submission files are stored as BYTEA with the same size cap the
-- API enforces for notice attachments. A submission belongs to an enrolled
-- student and is never public: reads require the learning permission or a
-- guardian link to that student.

CREATE TABLE learning_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  resource_type VARCHAR(30) NOT NULL DEFAULT 'document'
    CHECK (resource_type IN ('document', 'link', 'video', 'audio', 'image', 'other')),
  subject_id UUID,
  class_id UUID,
  url VARCHAR(1000),
  visibility VARCHAR(20) NOT NULL DEFAULT 'all'
    CHECK (visibility IN ('all', 'staff', 'students', 'parents')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_learning_resources_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_learning_resources_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_learning_resources_class
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_learning_resources_updated_at BEFORE UPDATE ON learning_resources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE learning_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  resource_id UUID NOT NULL,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(120) NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 1048576),
  data BYTEA NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_learning_attachments_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_learning_attachments_resource
    FOREIGN KEY (school_id, resource_id) REFERENCES learning_resources(school_id, id) ON DELETE CASCADE
);

CREATE TABLE homework_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL,
  section_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  title VARCHAR(200) NOT NULL,
  instructions TEXT NOT NULL,
  available_from DATE,
  due_at TIMESTAMPTZ NOT NULL,
  max_marks NUMERIC(6, 2) CHECK (max_marks IS NULL OR max_marks > 0),
  allow_resubmission BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'closed')),
  published_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_homework_assignments_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_homework_assignments_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_homework_assignments_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_homework_assignments_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_homework_assignments_published
    CHECK ((status <> 'published') OR published_at IS NOT NULL)
);

CREATE TRIGGER trg_homework_assignments_updated_at BEFORE UPDATE ON homework_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_homework_assignments_section
  ON homework_assignments (school_id, section_id, due_at DESC);

CREATE TABLE homework_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL,
  student_id UUID NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 10),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status VARCHAR(20) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'late', 'reviewed', 'returned')),
  content TEXT,
  attachment_name VARCHAR(255),
  attachment_type VARCHAR(120),
  attachment_size INTEGER CHECK (attachment_size IS NULL OR attachment_size BETWEEN 1 AND 1048576),
  attachment_data BYTEA,
  marks NUMERIC(6, 2) CHECK (marks IS NULL OR marks >= 0),
  feedback TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT uq_homework_submissions_attempt UNIQUE (school_id, assignment_id, student_id, attempt),
  CONSTRAINT uq_homework_submissions_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_homework_submissions_assignment
    FOREIGN KEY (school_id, assignment_id) REFERENCES homework_assignments(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_homework_submissions_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_homework_submissions_review
    CHECK ((status IN ('reviewed', 'returned')) = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT chk_homework_submissions_attachment
    CHECK (
      (attachment_data IS NULL AND attachment_name IS NULL AND attachment_type IS NULL AND attachment_size IS NULL)
      OR (attachment_data IS NOT NULL AND attachment_name IS NOT NULL AND attachment_type IS NOT NULL AND attachment_size IS NOT NULL)
    )
);

CREATE INDEX idx_homework_submissions_student
  ON homework_submissions (school_id, student_id, submitted_at DESC);

CREATE TABLE question_bank_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  subject_id UUID NOT NULL,
  topic VARCHAR(160),
  question_type VARCHAR(20) NOT NULL DEFAULT 'short_answer'
    CHECK (question_type IN ('short_answer', 'long_answer', 'multiple_choice', 'true_false', 'practical')),
  difficulty VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (difficulty IN ('easy', 'medium', 'hard')),
  question_text TEXT NOT NULL,
  answer_text TEXT,
  marks NUMERIC(6, 2) CHECK (marks IS NULL OR marks > 0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_question_bank_items_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_question_bank_items_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_question_bank_items_subject
  ON question_bank_items (school_id, subject_id, difficulty);


-- ----------------------------------------------------------------------------
-- Migration: 0025_concerns.sql (SHA-256: 34c16abb5ba24228791f19a1e661187cb4ddbdb420d4532744de274a83020190)
-- ----------------------------------------------------------------------------

-- 0025 Generic concerns, complaints, tasks and SLA tracking.
--
-- This is deliberately separate from safeguarding_cases. Safeguarding keeps its
-- own stricter permission and never appears in generic ticket lists, exports or
-- requester-visible notes. SLA hours are category configuration; overdue is
-- derived from sla_due_at rather than stored, so a policy change does not rewrite
-- history.

CREATE TABLE concern_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  default_priority VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (default_priority IN ('low', 'medium', 'high', 'urgent')),
  sla_hours INTEGER NOT NULL DEFAULT 24 CHECK (sla_hours BETWEEN 1 AND 8760),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_concern_categories_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_concern_categories_school_id_id UNIQUE (school_id, id)
);

CREATE TABLE concerns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  reference VARCHAR(40) NOT NULL,
  category_id UUID,
  subject VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requester_name VARCHAR(200) NOT NULL,
  requester_email VARCHAR(320),
  student_id UUID,
  assigned_to UUID REFERENCES users(id) ON DELETE RESTRICT,
  priority VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'waiting', 'resolved', 'closed', 'cancelled')),
  visibility VARCHAR(20) NOT NULL DEFAULT 'requester'
    CHECK (visibility IN ('internal', 'requester')),
  sla_due_at TIMESTAMPTZ NOT NULL,
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_summary TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_concerns_school_reference UNIQUE (school_id, reference),
  CONSTRAINT uq_concerns_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_concerns_category
    FOREIGN KEY (school_id, category_id) REFERENCES concern_categories(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_concerns_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_concerns_resolution
    CHECK ((status = 'resolved' AND resolved_at IS NOT NULL) OR status <> 'resolved')
);

CREATE TRIGGER trg_concerns_updated_at BEFORE UPDATE ON concerns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_concerns_queue
  ON concerns (school_id, status, priority, sla_due_at);
CREATE INDEX idx_concerns_requester
  ON concerns (school_id, requester_user_id, created_at DESC);

CREATE TABLE concern_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  concern_id UUID NOT NULL,
  event_type VARCHAR(30) NOT NULL
    CHECK (event_type IN ('created', 'assigned', 'status_changed', 'note_added', 'escalated', 'resolved', 'reopened', 'attachment_added')),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note TEXT,
  is_internal BOOLEAN NOT NULL DEFAULT TRUE,
  from_status VARCHAR(20),
  to_status VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_concern_events_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_concern_events_concern
    FOREIGN KEY (school_id, concern_id) REFERENCES concerns(school_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_concern_events_timeline
  ON concern_events (school_id, concern_id, created_at);

CREATE TABLE concern_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  concern_id UUID NOT NULL,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(120) NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 1048576),
  data BYTEA NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_internal BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_concern_attachments_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_concern_attachments_concern
    FOREIGN KEY (school_id, concern_id) REFERENCES concerns(school_id, id) ON DELETE RESTRICT
);


-- ----------------------------------------------------------------------------
-- Migration: 0026_notifications.sql (SHA-256: 41548cc7b98164982974079914caaba93be716601d5438d3090e1cb005a52e32)
-- ----------------------------------------------------------------------------

-- 0026 Notifications: in-app inbox, outbox and delivery preferences.
--
-- External delivery is provider-dependent. The outbox records what was queued
-- and every attempt; a message is only marked sent after a provider confirms it.
-- With no provider configured the row ends as blocked, never as sent. Consent is
-- stored per channel and checked before an external message is queued.

CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(60) NOT NULL,
  channel VARCHAR(20) NOT NULL
    CHECK (channel IN ('email', 'sms', 'inapp', 'whatsapp')),
  subject VARCHAR(200),
  body TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_templates_school_code_channel UNIQUE (school_id, code, channel),
  CONSTRAINT uq_notification_templates_school_id_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_notification_templates_updated_at BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE in_app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  link VARCHAR(500),
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  dedupe_key VARCHAR(120),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_in_app_notifications_school_id_id UNIQUE (school_id, id)
);

CREATE UNIQUE INDEX uq_in_app_notifications_dedupe
  ON in_app_notifications (school_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_in_app_notifications_inbox
  ON in_app_notifications (school_id, user_id, read_at, created_at DESC);

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  channel VARCHAR(20) NOT NULL
    CHECK (channel IN ('email', 'sms', 'inapp', 'whatsapp')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  consent_given_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_preferences_school_user_channel UNIQUE (school_id, user_id, channel),
  CONSTRAINT chk_notification_preferences_consent
    CHECK (channel = 'inapp' OR enabled = FALSE OR consent_given_at IS NOT NULL)
);

CREATE TABLE notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  channel VARCHAR(20) NOT NULL
    CHECK (channel IN ('email', 'sms', 'whatsapp')),
  recipient_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  recipient_address VARCHAR(320) NOT NULL,
  template_code VARCHAR(60),
  subject VARCHAR(200),
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'blocked', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  provider VARCHAR(60),
  provider_message_id VARCHAR(200),
  dedupe_key VARCHAR(120),
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  CONSTRAINT uq_notification_outbox_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_notification_outbox_sent
    CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_notification_outbox_dedupe
  ON notification_outbox (school_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_notification_outbox_queue
  ON notification_outbox (school_id, status, next_attempt_at);

CREATE TRIGGER trg_notification_outbox_updated_at BEFORE UPDATE ON notification_outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE notification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  outbox_id UUID NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('sent', 'failed', 'blocked')),
  provider VARCHAR(60),
  error TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_attempts_school_id_id UNIQUE (school_id, id),
  CONSTRAINT uq_notification_attempts_number UNIQUE (school_id, outbox_id, attempt_no),
  CONSTRAINT fk_notification_attempts_outbox
    FOREIGN KEY (school_id, outbox_id) REFERENCES notification_outbox(school_id, id) ON DELETE CASCADE
);


-- ----------------------------------------------------------------------------
-- Migration: 0027_fee_reconciliation.sql (SHA-256: 659be52f0c612782be68da1591e0450d40d229d2ddb20697ac45550d4a2cb56a)
-- ----------------------------------------------------------------------------

-- 0027 Fee reconciliation, concessions and write-offs.
--
-- A charge's collectable amount is now amount - concession_amount -
-- write_off_amount. Every code path that derives a balance must subtract all
-- three; the column default keeps existing rows correct. Write-offs are only
-- written through the API, which records an evidence row in fee_write_offs and
-- an audit event in the same transaction.
--
-- Bank/UPI statement reconciliation is an offline review workflow: imported
-- lines are matched to recorded payments by the finance user. The system never
-- claims a payment was received from a statement alone.

ALTER TABLE student_charges
  ADD COLUMN write_off_amount NUMERIC(12, 2) NOT NULL DEFAULT 0
    CHECK (write_off_amount >= 0);

ALTER TABLE student_charges
  ADD CONSTRAINT chk_student_charges_collectable
  CHECK (concession_amount + write_off_amount <= amount);

CREATE TABLE fee_concession_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  charge_id UUID NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  CONSTRAINT uq_fee_concession_requests_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_fee_concession_requests_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fee_concession_requests_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fee_concession_requests_charge
    FOREIGN KEY (school_id, charge_id) REFERENCES student_charges(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_fee_concession_requests_reason CHECK (length(btrim(reason)) >= 5),
  CONSTRAINT chk_fee_concession_requests_review CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected', 'cancelled'))
  )
);

CREATE UNIQUE INDEX uq_fee_concession_requests_pending
  ON fee_concession_requests (school_id, charge_id)
  WHERE status = 'pending';
CREATE INDEX idx_fee_concession_requests_queue
  ON fee_concession_requests (school_id, status, requested_at);

CREATE TABLE fee_write_offs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  charge_id UUID NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_fee_write_offs_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_fee_write_offs_charge
    FOREIGN KEY (school_id, charge_id) REFERENCES student_charges(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_fee_write_offs_reason CHECK (length(btrim(reason)) >= 5)
);

CREATE INDEX idx_fee_write_offs_charge ON fee_write_offs (school_id, charge_id);

CREATE TABLE fee_reconciliation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  reference VARCHAR(80) NOT NULL,
  source VARCHAR(60) NOT NULL DEFAULT 'bank_statement',
  statement_from DATE,
  statement_to DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'balanced', 'closed')),
  opening_balance NUMERIC(14, 2) CHECK (opening_balance IS NULL OR opening_balance >= 0),
  closing_balance NUMERIC(14, 2) CHECK (closing_balance IS NULL OR closing_balance >= 0),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ,
  CONSTRAINT uq_fee_reconciliation_batches_school_reference
    UNIQUE (school_id, reference),
  CONSTRAINT uq_fee_reconciliation_batches_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_fee_reconciliation_batches_dates CHECK (
    statement_to IS NULL OR statement_from IS NULL OR statement_to >= statement_from
  ),
  CONSTRAINT chk_fee_reconciliation_batches_closed CHECK (
    (status = 'closed') = (closed_at IS NOT NULL)
  )
);

CREATE TRIGGER trg_fee_reconciliation_batches_updated_at
  BEFORE UPDATE ON fee_reconciliation_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fee_reconciliation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  paid_on DATE NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount <> 0),
  reference VARCHAR(160),
  method VARCHAR(30) NOT NULL DEFAULT 'other'
    CHECK (method IN ('cash', 'bank_transfer', 'card', 'upi', 'cheque', 'other')),
  status VARCHAR(20) NOT NULL DEFAULT 'unmatched'
    CHECK (status IN ('unmatched', 'matched', 'exception')),
  matched_payment_id UUID,
  exception_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_fee_reconciliation_lines_batch_no UNIQUE (school_id, batch_id, line_no),
  CONSTRAINT uq_fee_reconciliation_lines_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_fee_reconciliation_lines_batch
    FOREIGN KEY (school_id, batch_id) REFERENCES fee_reconciliation_batches(school_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_fee_reconciliation_lines_payment
    FOREIGN KEY (school_id, matched_payment_id) REFERENCES payments(school_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_fee_reconciliation_lines_match CHECK (
    (status = 'matched') = (matched_payment_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_fee_reconciliation_lines_payment
  ON fee_reconciliation_lines (school_id, matched_payment_id)
  WHERE matched_payment_id IS NOT NULL;
CREATE INDEX idx_fee_reconciliation_lines_batch
  ON fee_reconciliation_lines (school_id, batch_id, status);


-- ----------------------------------------------------------------------------
-- Migration: 0028_saved_reports_imports.sql (SHA-256: f2305fa18b6f066d0643a47722aa1cc71b15e8cf617b48a65de094831cc254a8)
-- ----------------------------------------------------------------------------

-- 0028 Saved report views and two-step CSV imports.
--
-- A saved report stores only the query definition (type + filters) plus a name;
-- results are recomputed on open so a saved view can never show stale totals.
-- An import is always previewed first: rows and validation errors are stored,
-- then a separate commit call applies only the valid rows. Committing twice is
-- refused, which makes the workflow safe to retry after a dropped connection.

CREATE TABLE saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  report_type VARCHAR(40) NOT NULL
    CHECK (report_type IN ('students', 'attendance', 'fees')),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_saved_reports_school_name UNIQUE (school_id, name),
  CONSTRAINT uq_saved_reports_school_id_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_saved_reports_updated_at BEFORE UPDATE ON saved_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_saved_reports_owner
  ON saved_reports (school_id, created_by, name);

CREATE TABLE import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  entity_type VARCHAR(40) NOT NULL
    CHECK (entity_type IN ('students', 'library_books', 'vendors')),
  filename VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'previewed'
    CHECK (status IN ('previewed', 'committed', 'cancelled')),
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows INTEGER NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  invalid_rows INTEGER NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
  created_rows INTEGER NOT NULL DEFAULT 0 CHECK (created_rows >= 0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  committed_at TIMESTAMPTZ,
  CONSTRAINT uq_import_batches_school_id_id UNIQUE (school_id, id),
  CONSTRAINT chk_import_batches_counts CHECK (valid_rows + invalid_rows = total_rows),
  CONSTRAINT chk_import_batches_commit CHECK (
    (status = 'committed') = (committed_at IS NOT NULL)
  )
);

CREATE INDEX idx_import_batches_owner
  ON import_batches (school_id, created_by, created_at DESC);

CREATE TABLE import_batch_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  payload JSONB NOT NULL,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  action VARCHAR(20) NOT NULL DEFAULT 'skip'
    CHECK (action IN ('create', 'update', 'skip')),
  created_entity_id UUID,
  CONSTRAINT uq_import_batch_rows_batch_row UNIQUE (school_id, batch_id, row_number),
  CONSTRAINT uq_import_batch_rows_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_import_batch_rows_batch
    FOREIGN KEY (school_id, batch_id) REFERENCES import_batches(school_id, id)
    ON DELETE CASCADE
);

CREATE INDEX idx_import_batch_rows_batch
  ON import_batch_rows (school_id, batch_id, row_number);


-- ----------------------------------------------------------------------------
-- Migration: 0029_rls_extension.sql (SHA-256: 861d86bc7c920306c9ff4aaf4c6613c6474a5e2bcf8534a3023bd09d44774ae0)
-- ----------------------------------------------------------------------------

-- 0029 Extend row-level security and grants to the modules added after 0018.
--
-- Every new school-owned table gets the same tenant_isolation policy used by
-- the original migration. Tables are listed explicitly; a new table must be
-- added here (and covered by a test) before it is considered tenant-safe.
-- This remains defence in depth: the API runs as the database owner locally, so
-- the application-level school_id filters are the primary control.

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT USAGE ON SCHEMA public TO erp_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
  END IF;
END
$grants$;

DO $policies$
DECLARE
  tenant_table TEXT;
  policy_expression TEXT :=
    'school_id = nullif(current_setting(''app.school_id'', true), '''')::uuid';
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    -- Staff attendance and recruitment
    'staff_shifts', 'staff_shift_assignments', 'staff_attendance',
    'staff_attendance_corrections', 'staff_attendance_settings',
    'vacancies', 'candidates', 'candidate_interviews', 'job_offers',
    'onboarding_tasks', 'employee_changes', 'staff_separations', 'exit_tasks',
    -- Procurement
    'vendors', 'procurement_budgets', 'purchase_requests',
    'purchase_request_items', 'purchase_orders', 'purchase_order_items',
    'goods_receipts', 'goods_receipt_items', 'vendor_bills',
    'procurement_expenses', 'procurement_approvals',
    -- Transport
    'transport_vehicles', 'transport_drivers', 'transport_routes',
    'transport_stops', 'student_transport_allocations', 'transport_maintenance',
    -- Library
    'library_categories', 'library_books', 'library_copies', 'library_members',
    'library_settings', 'library_loans', 'library_fines', 'library_reservations',
    -- Learning
    'learning_resources', 'learning_attachments', 'homework_assignments',
    'homework_submissions', 'question_bank_items',
    -- Concerns
    'concern_categories', 'concerns', 'concern_events', 'concern_attachments',
    -- Notifications
    'notification_templates', 'in_app_notifications', 'notification_preferences',
    'notification_outbox', 'notification_attempts',
    -- Fee reconciliation
    'fee_concession_requests', 'fee_write_offs',
    'fee_reconciliation_batches', 'fee_reconciliation_lines',
    -- Saved reports and imports
    'saved_reports', 'import_batches', 'import_batch_rows'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tenant_table
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tenant_table);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (%s) WITH CHECK (%s)',
        tenant_table, policy_expression, policy_expression
      );
    END IF;
  END LOOP;
END
$policies$;


-- ----------------------------------------------------------------------------
-- Migration: 0030_transport_stop_retirement.sql (SHA-256: c33375bf6fd020549fbb1814d3e5390fcf0cd92a641ae447461108a4de6a2f8d)
-- ----------------------------------------------------------------------------

-- Retire route stops instead of deleting them when historical transport
-- allocations still reference the stop. The allocation history is evidence of
-- which stop a student was assigned to, so the row must survive.
ALTER TABLE transport_stops ADD COLUMN retired_at TIMESTAMPTZ;

ALTER TABLE transport_stops DROP CONSTRAINT uq_transport_stops_route_sequence;

CREATE UNIQUE INDEX uq_transport_stops_active_sequence
  ON transport_stops (school_id, route_id, sequence_no)
  WHERE retired_at IS NULL;

CREATE INDEX idx_transport_stops_active
  ON transport_stops (school_id, route_id, sequence_no)
  WHERE retired_at IS NULL;


-- ----------------------------------------------------------------------------
-- Migration: 0031_rang_biranga_core.sql (SHA-256: f29b5d648d8c44f362b94c3a9f65aaad643389d96fa04f1a379edb8f9b6432c2)
-- ----------------------------------------------------------------------------

-- 0031 Rang-Biranga Core Extension:
-- 1. Student user linking & profile extensions (roll number, blood group, emergency contact)
-- 2. Offline payment acknowledgements & finance verification queue
-- 3. Configuration Studio & versioned school settings
-- 4. Attendance shortage cases & 80% threshold policy tracking
-- 5. Student profile correction requests
-- 6. Learning assistant query audit & approved citations
-- 7. Teacher eligibility profiles & qualification verification
-- 8. Row-Level Security extensions for all new tenant tables

-- 1. Students enhancement
ALTER TABLE students ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS roll_number VARCHAR(30);
ALTER TABLE students ADD COLUMN IF NOT EXISTS blood_group VARCHAR(10);
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(40);
ALTER TABLE students ADD COLUMN IF NOT EXISTS cbse_reg_no VARCHAR(40);

CREATE UNIQUE INDEX IF NOT EXISTS uq_students_school_user
  ON students (school_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_students_user
  ON students (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_students_roll_number
  ON students (school_id, roll_number)
  WHERE roll_number IS NOT NULL;

-- 2. Fee Offline Payment Acknowledgements
CREATE TABLE IF NOT EXISTS fee_offline_payment_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  guardian_id UUID,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(30) NOT NULL DEFAULT 'bank_transfer'
    CHECK (payment_method IN ('cash', 'cheque', 'bank_transfer', 'upi', 'demand_draft', 'pos_slip', 'other')),
  reference_number VARCHAR(120) NOT NULL,
  payment_date DATE NOT NULL,
  bank_name VARCHAR(120),
  evidence_url TEXT,
  notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'under_review', 'verified', 'rejected', 'unmatched', 'more_info_needed')),
  verified_payment_id UUID,
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  parent_contacted_at TIMESTAMPTZ,
  parent_contact_outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_fee_offline_ack_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_fee_offline_ack_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fee_offline_ack_guardian
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fee_offline_ack_payment
    FOREIGN KEY (school_id, verified_payment_id) REFERENCES payments(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_fee_offline_ack_updated_at
  BEFORE UPDATE ON fee_offline_payment_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_fee_offline_ack_queue
  ON fee_offline_payment_acknowledgements (school_id, status, payment_date);

CREATE INDEX IF NOT EXISTS idx_fee_offline_ack_student
  ON fee_offline_payment_acknowledgements (school_id, student_id);

-- 3. Configuration Studio & School Settings
CREATE TABLE IF NOT EXISTS school_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  config_key VARCHAR(80) NOT NULL,
  config_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status VARCHAR(20) NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_school_config_version UNIQUE (school_id, config_key, version),
  CONSTRAINT uq_school_config_school_id_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_school_config_updated_at
  BEFORE UPDATE ON school_configurations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_school_config_lookup
  ON school_configurations (school_id, config_key, status, version DESC);

-- 4. Attendance Shortage Cases (80% Policy & Condonation Workflow)
CREATE TABLE IF NOT EXISTS attendance_shortage_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  calculated_attendance_rate NUMERIC(5, 2) NOT NULL CHECK (calculated_attendance_rate >= 0 AND calculated_attendance_rate <= 100),
  threshold_percent NUMERIC(5, 2) NOT NULL DEFAULT 80.00,
  total_working_days INTEGER NOT NULL CHECK (total_working_days > 0),
  days_attended NUMERIC(5, 1) NOT NULL CHECK (days_attended >= 0),
  stage VARCHAR(40) NOT NULL DEFAULT 'potential_shortage'
    CHECK (stage IN ('potential_shortage', 'warning_issued', 'parent_informed', 'explanation_received', 'condonation_requested', 'under_review', 'decision_rendered', 'resolved')),
  warning_level VARCHAR(20) DEFAULT 'first'
    CHECK (warning_level IN ('first', 'second', 'final')),
  internal_exam_eligibility VARCHAR(30) DEFAULT 'eligible'
    CHECK (internal_exam_eligibility IN ('eligible', 'conditional', 'debarred', 'under_review')),
  board_exam_eligibility VARCHAR(30) DEFAULT 'not_applicable'
    CHECK (board_exam_eligibility IN ('eligible', 'condonation_submitted', 'condoned_by_board', 'ineligible', 'not_applicable')),
  explanation_text TEXT,
  medical_leave_days NUMERIC(5, 1) DEFAULT 0,
  authorized_decision VARCHAR(160),
  decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  decision_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_attendance_shortage_case UNIQUE (school_id, student_id, academic_year_id),
  CONSTRAINT uq_attendance_shortage_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_att_shortage_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_att_shortage_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_att_shortage_updated_at
  BEFORE UPDATE ON attendance_shortage_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_att_shortage_stage
  ON attendance_shortage_cases (school_id, stage, academic_year_id);

-- 5. Student Profile Correction Requests
CREATE TABLE IF NOT EXISTS student_profile_correction_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  field_name VARCHAR(60) NOT NULL,
  current_value TEXT,
  proposed_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  supporting_doc_name VARCHAR(160),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_profile_corr_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_student_profile_corr_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_student_profile_corr_queue
  ON student_profile_correction_requests (school_id, status, created_at);

-- 6. Learning Assistant Query Audit
CREATE TABLE IF NOT EXISTS learning_assistant_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  class_id UUID,
  subject_id UUID,
  topic VARCHAR(120),
  prompt TEXT NOT NULL,
  language VARCHAR(10) DEFAULT 'en',
  mode VARCHAR(30) DEFAULT 'qa'
    CHECK (mode IN ('qa', 'explain', 'summarize', 'revision_notes', 'practice_questions', 'quiz')),
  response_text TEXT NOT NULL,
  citations JSONB DEFAULT '[]'::jsonb,
  provider VARCHAR(40) NOT NULL DEFAULT 'deterministic_local',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_learning_ast_query_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_learning_ast_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_learning_ast_student
  ON learning_assistant_queries (school_id, student_id, created_at DESC);

-- 7. Teacher Eligibility Profiles
CREATE TABLE IF NOT EXISTS teacher_eligibility_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  min_grade_order INTEGER NOT NULL DEFAULT 1,
  max_grade_order INTEGER NOT NULL DEFAULT 12,
  qualification VARCHAR(140) NOT NULL,
  verification_status VARCHAR(20) NOT NULL DEFAULT 'verified'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  max_weekly_periods INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_teacher_eligibility_staff_subject UNIQUE (school_id, staff_id, subject_id),
  CONSTRAINT uq_teacher_eligibility_school_id_id UNIQUE (school_id, id),
  CONSTRAINT fk_teacher_eligibility_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_teacher_eligibility_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_teacher_grade_range CHECK (min_grade_order <= max_grade_order)
);

CREATE INDEX IF NOT EXISTS idx_teacher_eligibility_lookup
  ON teacher_eligibility_profiles (school_id, staff_id, verification_status);

-- 8. Apply RLS & permissions to all new tenant tables
DO $policies$
DECLARE
  tenant_table TEXT;
  policy_expression TEXT :=
    'school_id = nullif(current_setting(''app.school_id'', true), '''')::uuid';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT USAGE ON SCHEMA public TO erp_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
  END IF;

  FOREACH tenant_table IN ARRAY ARRAY[
    'fee_offline_payment_acknowledgements',
    'school_configurations',
    'attendance_shortage_cases',
    'student_profile_correction_requests',
    'learning_assistant_queries',
    'teacher_eligibility_profiles'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tenant_table
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tenant_table);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (%s) WITH CHECK (%s)',
        tenant_table, policy_expression, policy_expression
      );
    END IF;
  END LOOP;
END
$policies$;


-- ----------------------------------------------------------------------------
-- Migration: 0032_parent_student_advanced_attendance.sql (SHA-256: d0e01f02467258a5f05b8f048eac56a299d6a9f94cd8cbb25ca766c3d82d199e)
-- ----------------------------------------------------------------------------

-- 0032 Parent Portal, Student Portal & Advanced Period Attendance (Classes VI to XII)
--
-- 1. Stream support on sections & enrollments (Science, Commerce, Humanities, General)
-- 2. Period-wise attendance for Classes 6-12 (subject, teacher, employee code, timings)
-- 3. Timetable substitutions (original teacher preserved, substitute recorded separately)
-- 4. Student leave requests (medical, personal, travel with review workflow)
-- 5. Authorised pickup persons (family member, relationship, photo/ID proof, validity)
-- 6. Student document consents (annual consent, trip consent, medical info)
-- 7. Parent-student direct messages & PTM notices
-- 8. Transport alert preferences (bus approaching, boarding, drop-off, delays)
-- 9. Row-Level Security (RLS) policies for all new tenant tables

-- 1. Stream support
ALTER TABLE sections ADD COLUMN IF NOT EXISTS stream VARCHAR(40) DEFAULT 'general';
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS stream VARCHAR(40) DEFAULT 'general';

-- 2. Period-wise Attendance (Classes 6-12)
CREATE TABLE IF NOT EXISTS student_period_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  section_id UUID NOT NULL,
  period_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused', 'unmarked')),
  teacher_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  substitute_teacher_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  marked_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_period_attendance UNIQUE (enrollment_id, attendance_date, period_id),
  CONSTRAINT uq_student_period_att_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_student_period_att_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_period_att_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_period_att_period
    FOREIGN KEY (school_id, period_id) REFERENCES timetable_periods(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_period_att_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_student_period_att_updated_at
  BEFORE UPDATE ON student_period_attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_period_att_lookup
  ON student_period_attendance (school_id, student_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_period_att_section_date
  ON student_period_attendance (school_id, section_id, attendance_date, period_id);

CREATE INDEX IF NOT EXISTS idx_period_att_subject
  ON student_period_attendance (school_id, student_id, subject_id);

-- 3. Timetable Substitutions
CREATE TABLE IF NOT EXISTS timetable_substitutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  slot_id UUID NOT NULL,
  substitution_date DATE NOT NULL,
  original_teacher_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  substitute_teacher_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_timetable_sub_slot_date UNIQUE (slot_id, substitution_date),
  CONSTRAINT uq_timetable_sub_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_timetable_sub_slot
    FOREIGN KEY (school_id, slot_id) REFERENCES timetable_slots(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_timetable_sub_updated_at
  BEFORE UPDATE ON timetable_substitutions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_timetable_sub_date
  ON timetable_substitutions (school_id, substitution_date, status);

-- 4. Student Leave Requests
CREATE TABLE IF NOT EXISTS student_leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  guardian_id UUID NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  reason_category VARCHAR(40) NOT NULL
    CHECK (reason_category IN ('medical', 'personal', 'family_function', 'emergency', 'travel', 'other')),
  reason_text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_student_leave_dates CHECK (ends_on >= starts_on),
  CONSTRAINT uq_student_leave_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_student_leave_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_leave_guardian
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_student_leave_updated_at
  BEFORE UPDATE ON student_leave_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_student_leave_lookup
  ON student_leave_requests (school_id, student_id, status);

-- 5. Student Pickup Authorisations
CREATE TABLE IF NOT EXISTS student_pickup_authorisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  guardian_id UUID NOT NULL,
  authorised_person_name VARCHAR(120) NOT NULL,
  relationship VARCHAR(60) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  id_proof_type VARCHAR(40) NOT NULL DEFAULT 'Aadhaar'
    CHECK (id_proof_type IN ('Aadhaar', 'PAN', 'Voter_ID', 'Driving_License', 'Passport', 'Other')),
  id_proof_number VARCHAR(80),
  photo_url TEXT,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  emergency_only BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_pickup_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_student_pickup_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_pickup_guardian
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_student_pickup_updated_at
  BEFORE UPDATE ON student_pickup_authorisations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_student_pickup_lookup
  ON student_pickup_authorisations (school_id, student_id, status);

-- 6. Student Document Consents
CREATE TABLE IF NOT EXISTS student_document_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  guardian_id UUID,
  academic_year_id UUID,
  document_type VARCHAR(40) NOT NULL
    CHECK (document_type IN ('annual_consent', 'trip_consent', 'medical_info', 'emergency_contact', 'id_proof', 'transport_consent', 'other')),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'verified', 'rejected', 'expired')),
  submitted_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_doc_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_student_doc_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_doc_guardian
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_doc_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_student_doc_updated_at
  BEFORE UPDATE ON student_document_consents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_student_doc_lookup
  ON student_document_consents (school_id, student_id, status);

-- 7. Parent-Student Direct Messages & PTM Notices
CREATE TABLE IF NOT EXISTS parent_student_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sender_role VARCHAR(40) NOT NULL DEFAULT 'teacher'
    CHECK (sender_role IN ('teacher', 'admin', 'coordinator', 'system')),
  sender_name VARCHAR(120) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'teacher_note'
    CHECK (category IN ('teacher_note', 'ptm_reminder', 'attendance_alert', 'fee_reminder', 'general_announcement')),
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  action_link VARCHAR(300),
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_parent_msg_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_parent_msg_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_parent_msg_updated_at
  BEFORE UPDATE ON parent_student_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_parent_msg_lookup
  ON parent_student_messages (school_id, student_id, is_read, created_at DESC);

-- 8. Transport Alert Preferences
CREATE TABLE IF NOT EXISTS student_transport_alert_preferences (
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  guardian_id UUID NOT NULL,
  bus_approaching BOOLEAN NOT NULL DEFAULT true,
  boarding BOOLEAN NOT NULL DEFAULT true,
  drop_off BOOLEAN NOT NULL DEFAULT true,
  delays BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, student_id, guardian_id),
  CONSTRAINT fk_transport_pref_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_transport_pref_guardian
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id) ON DELETE RESTRICT
);

-- 9. Row-Level Security Policies (Tenant isolation)
ALTER TABLE student_period_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_student_period_attendance ON student_period_attendance
  FOR ALL TO erp_app
  USING (school_id = current_setting('app.school_id', true)::uuid)
  WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);

ALTER TABLE timetable_substitutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_timetable_substitutions ON timetable_substitutions
  FOR ALL TO erp_app
  USING (school_id = current_setting('app.school_id', true)::uuid)
  WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);

ALTER TABLE student_leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_student_leave_requests ON student_leave_requests
  FOR ALL TO erp_app
  USING (school_id = current_setting('app.school_id', true)::uuid)
  WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);

ALTER TABLE student_pickup_authorisations ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_student_pickup_authorisations ON student_pickup_authorisations
  FOR ALL TO erp_app
  USING (school_id = current_setting('app.school_id', true)::uuid)
  WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);

ALTER TABLE student_document_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_student_document_consents ON student_document_consents
  FOR ALL TO erp_app
  USING (school_id = current_setting('app.school_id', true)::uuid)
  WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);

ALTER TABLE parent_student_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_parent_student_messages ON parent_student_messages
  FOR ALL TO erp_app
  USING (school_id = current_setting('app.school_id', true)::uuid)
  WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);

ALTER TABLE student_transport_alert_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_student_transport_alert_preferences ON student_transport_alert_preferences
  FOR ALL TO erp_app
  USING (school_id = current_setting('app.school_id', true)::uuid)
  WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);


-- ----------------------------------------------------------------------------
-- Migration: 0033_geo_face_staff_attendance.sql (SHA-256: c7957853686e289bfa1f296faba1856bf9b992c8cf232f168f4862fce568025b)
-- ----------------------------------------------------------------------------

-- 0033 Geo-Fenced, Face-Verified Staff Biometric Attendance System
--
-- Implements secure, configurable attendance for all authorised employees and
-- personnel (teaching, non-teaching, administrative, management, accounts,
-- transport, etc.), explicitly excluding students from mandatory biometric punch.
-- Includes geofencing, facial biometric enrolment & consent, liveness verification,
-- punch-in/out state management, manual exception requests, and dedicated kiosks.

-- 1. School Geofences (Campuses, grounds, transport depots & approved off-site locations)
CREATE TABLE IF NOT EXISTS school_geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  campus_id UUID REFERENCES campuses(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  location_type VARCHAR(40) NOT NULL DEFAULT 'campus'
    CHECK (location_type IN ('campus', 'sports_ground', 'transport_depot', 'approved_offsite', 'event_venue')),
  latitude NUMERIC(10, 7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(10, 7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_meters INTEGER NOT NULL DEFAULT 150 CHECK (radius_meters BETWEEN 20 AND 5000),
  max_accuracy_threshold_meters INTEGER NOT NULL DEFAULT 100 CHECK (max_accuracy_threshold_meters BETWEEN 10 AND 500),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_school_geofences_school_name UNIQUE (school_id, name),
  CONSTRAINT uq_school_geofences_school_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_school_geofences_updated_at
  BEFORE UPDATE ON school_geofences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_school_geofences_active
  ON school_geofences (school_id, is_active);

-- 2. Staff Biometric Profiles (Consent, Mathematical Template Embeddings & Enrolment Status)
CREATE TABLE IF NOT EXISTS staff_biometric_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  consent_given BOOLEAN NOT NULL DEFAULT FALSE,
  consent_version VARCHAR(40) NOT NULL DEFAULT 'v1.0-dpdpa',
  consent_given_at TIMESTAMPTZ,
  consent_withdrawn_at TIMESTAMPTZ,
  enrolment_status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (enrolment_status IN ('pending', 'enrolled', 'withdrawn', 'suspended')),
  enrolled_at TIMESTAMPTZ,
  enrolled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  template_algorithm VARCHAR(60) NOT NULL DEFAULT 'face_emb_v1_512',
  template_data_encrypted TEXT,
  template_hash VARCHAR(64) NOT NULL,
  photo_verification_hash VARCHAR(64),
  quality_score NUMERIC(5, 2) CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_biometric_staff UNIQUE (school_id, staff_id),
  CONSTRAINT uq_staff_biometric_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_staff_biometric_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_staff_biometric_updated_at
  BEFORE UPDATE ON staff_biometric_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_staff_biometric_lookup
  ON staff_biometric_profiles (school_id, staff_id, enrolment_status);

-- 3. Dedicated Attendance Kiosks (School-owned managed entrance tablets/devices)
CREATE TABLE IF NOT EXISTS attendance_kiosks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  campus_id UUID REFERENCES campuses(id) ON DELETE RESTRICT,
  device_code VARCHAR(60) NOT NULL,
  device_name VARCHAR(160) NOT NULL,
  geofence_id UUID REFERENCES school_geofences(id) ON DELETE SET NULL,
  api_key_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'maintenance')),
  last_heartbeat_at TIMESTAMPTZ,
  app_version VARCHAR(40),
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_attendance_kiosks_code UNIQUE (school_id, device_code),
  CONSTRAINT uq_attendance_kiosks_school_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_attendance_kiosks_updated_at
  BEFORE UPDATE ON attendance_kiosks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_attendance_kiosks_status
  ON attendance_kiosks (school_id, status);

-- 4. Staff Punch Events (Immutable telemetry of every biometric & GPS punch attempt)
CREATE TABLE IF NOT EXISTS staff_punch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  work_date DATE NOT NULL,
  punch_type VARCHAR(20) NOT NULL
    CHECK (punch_type IN ('punch_in', 'punch_out', 'break_start', 'break_end')),
  punched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verification_status VARCHAR(40) NOT NULL
    CHECK (verification_status IN (
      'verified',
      'out_of_geofence',
      'poor_accuracy',
      'face_mismatch',
      'liveness_failed',
      'camera_denied',
      'location_denied',
      'technical_failure',
      'manual_review_required',
      'approved_exception'
    )),
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  accuracy_meters NUMERIC(7, 2),
  distance_meters NUMERIC(8, 2),
  geofence_id UUID REFERENCES school_geofences(id) ON DELETE SET NULL,
  geofence_verified BOOLEAN NOT NULL DEFAULT FALSE,
  liveness_score NUMERIC(5, 2),
  liveness_verified BOOLEAN NOT NULL DEFAULT FALSE,
  match_confidence NUMERIC(5, 2),
  face_matched BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason TEXT,
  device_source VARCHAR(30) NOT NULL DEFAULT 'employee_mobile'
    CHECK (device_source IN ('employee_mobile', 'kiosk', 'supervisor_portal', 'desktop_browser')),
  kiosk_id UUID REFERENCES attendance_kiosks(id) ON DELETE SET NULL,
  client_metadata JSONB DEFAULT '{}'::jsonb,
  linked_punch_in_id UUID REFERENCES staff_punch_events(id) ON DELETE SET NULL,
  attendance_record_id UUID REFERENCES staff_attendance(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_punch_events_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_staff_punch_events_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_staff_punch_events_staff_date
  ON staff_punch_events (school_id, staff_id, work_date, punched_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_punch_events_status
  ON staff_punch_events (school_id, verification_status, punched_at DESC);

-- 5. Staff Attendance Exceptions & Fallbacks (Manual Request & Approval Workflow)
CREATE TABLE IF NOT EXISTS staff_attendance_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  work_date DATE NOT NULL,
  exception_type VARCHAR(40) NOT NULL
    CHECK (exception_type IN (
      'gps_failure',
      'camera_failure',
      'face_mismatch',
      'device_unavailable',
      'approved_offsite_duty',
      'missed_punch_in',
      'missed_punch_out',
      'other'
    )),
  requested_punch_in TIMESTAMPTZ,
  requested_punch_out TIMESTAMPTZ,
  reason TEXT NOT NULL,
  supporting_document_name VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_att_exceptions_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_staff_att_exceptions_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_staff_att_exceptions_review CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE TRIGGER trg_staff_att_exceptions_updated_at
  BEFORE UPDATE ON staff_attendance_exceptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_staff_att_exceptions_queue
  ON staff_attendance_exceptions (school_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_att_exceptions_staff
  ON staff_attendance_exceptions (school_id, staff_id, work_date DESC);

-- 6. Row-Level Security Policies for Tenant Isolation
ALTER TABLE school_geofences ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_school_geofences ON school_geofences
  FOR ALL USING (school_id = NULLIF(current_setting('app.school_id', true), '')::uuid);

ALTER TABLE staff_biometric_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_staff_biometric_profiles ON staff_biometric_profiles
  FOR ALL USING (school_id = NULLIF(current_setting('app.school_id', true), '')::uuid);

ALTER TABLE attendance_kiosks ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_attendance_kiosks ON attendance_kiosks
  FOR ALL USING (school_id = NULLIF(current_setting('app.school_id', true), '')::uuid);

ALTER TABLE staff_punch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_staff_punch_events ON staff_punch_events
  FOR ALL USING (school_id = NULLIF(current_setting('app.school_id', true), '')::uuid);

ALTER TABLE staff_attendance_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_staff_attendance_exceptions ON staff_attendance_exceptions
  FOR ALL USING (school_id = NULLIF(current_setting('app.school_id', true), '')::uuid);


-- ----------------------------------------------------------------------------
-- Migration: 0034_complete_school_erp_and_supabase.sql (SHA-256: 9b41a04b660697eb6ca18cf95158368193f29adf7ee6efd77f609466dfee316f)
-- ----------------------------------------------------------------------------

-- 0034 Complete School ERP Schema & Supabase Compatibility Extension:
-- 1. Module 21: Facilities & Maintenance Management (school_facilities, facility_maintenance_tickets)
-- 2. Module 23: PTM Appointments & Slot Bookings (ptm_slots, ptm_bookings)
-- 3. Module 24: Documents & Official School Certificates (school_certificates)
-- 4. Module 29: Sports, Arts, Clubs & Alumni Directory (school_clubs, club_memberships, alumni_records)
-- 5. Supabase Auth & JWT interoperability functions
-- 6. Row-Level Security (RLS) policies for all new tables with erp_app and authenticated role access

-- 1. Facilities & Maintenance
CREATE TABLE IF NOT EXISTS school_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  campus_id UUID REFERENCES campuses(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'classroom'
    CHECK (category IN ('classroom', 'laboratory', 'sports_ground', 'auditorium', 'library', 'cafeteria', 'washroom', 'admin_office', 'medical_room', 'other')),
  block_location VARCHAR(100),
  floor_number VARCHAR(30),
  capacity INT NOT NULL DEFAULT 40 CHECK (capacity >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'operational'
    CHECK (status IN ('operational', 'under_maintenance', 'out_of_service', 'renovating')),
  last_inspected_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_school_facilities_school_code UNIQUE (school_id, code),
  CONSTRAINT uq_school_facilities_school_id_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_school_facilities_updated_at
  BEFORE UPDATE ON school_facilities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_school_facilities_status
  ON school_facilities (school_id, category, status);

CREATE TABLE IF NOT EXISTS facility_maintenance_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL,
  ticket_number VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general'
    CHECK (category IN ('electrical', 'plumbing', 'furniture', 'hvac', 'safety', 'civil', 'cleaning', 'it_hardware', 'general')),
  priority VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  description TEXT NOT NULL,
  reported_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_to UUID REFERENCES staff(id) ON DELETE RESTRICT,
  status VARCHAR(30) NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled')),
  estimated_cost NUMERIC(12, 2) DEFAULT 0 CHECK (estimated_cost >= 0),
  actual_cost NUMERIC(12, 2) DEFAULT 0 CHECK (actual_cost >= 0),
  resolution_notes TEXT,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_facility_maint_ticket_number UNIQUE (school_id, ticket_number),
  CONSTRAINT uq_facility_maint_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_facility_maint_facility
    FOREIGN KEY (school_id, facility_id) REFERENCES school_facilities(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_facility_maintenance_updated_at
  BEFORE UPDATE ON facility_maintenance_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_facility_maint_queue
  ON facility_maintenance_tickets (school_id, status, priority, reported_at DESC);

-- 2. PTM Slots & Bookings
CREATE TABLE IF NOT EXISTS ptm_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  teacher_id UUID NOT NULL,
  title VARCHAR(150) NOT NULL DEFAULT 'Parent-Teacher Meeting',
  event_date DATE NOT NULL,
  start_time VARCHAR(10) NOT NULL,
  end_time VARCHAR(10) NOT NULL,
  room_location VARCHAR(100),
  max_parents INT NOT NULL DEFAULT 1 CHECK (max_parents >= 1),
  status VARCHAR(30) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'booked', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ptm_slots_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_ptm_slots_teacher
    FOREIGN KEY (school_id, teacher_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_ptm_slots_updated_at
  BEFORE UPDATE ON ptm_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_ptm_slots_schedule
  ON ptm_slots (school_id, event_date, teacher_id, status);

CREATE TABLE IF NOT EXISTS ptm_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  slot_id UUID NOT NULL,
  student_id UUID NOT NULL,
  guardian_id UUID NOT NULL,
  booking_notes TEXT,
  teacher_feedback TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'attended', 'no_show', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ptm_bookings_school_id UNIQUE (school_id, id),
  CONSTRAINT uq_ptm_bookings_slot_student UNIQUE (slot_id, student_id),
  CONSTRAINT fk_ptm_bookings_slot
    FOREIGN KEY (school_id, slot_id) REFERENCES ptm_slots(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ptm_bookings_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ptm_bookings_guardian
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_ptm_bookings_updated_at
  BEFORE UPDATE ON ptm_bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_ptm_bookings_student
  ON ptm_bookings (school_id, student_id);

-- 3. Documents & Official Certificates
CREATE TABLE IF NOT EXISTS school_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  certificate_type VARCHAR(50) NOT NULL
    CHECK (certificate_type IN ('transfer_certificate', 'bonafide', 'character_certificate', 'marksheet_duplicate', 'sports_merit', 'fee_clearance')),
  certificate_number VARCHAR(80) NOT NULL,
  student_id UUID NOT NULL,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  issued_on DATE NOT NULL,
  valid_until DATE,
  issued_reason TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  verification_hash VARCHAR(120) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'issued', 'revoked')),
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_school_certificates_num UNIQUE (school_id, certificate_number),
  CONSTRAINT uq_school_certificates_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_school_certificates_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_school_certificates_updated_at
  BEFORE UPDATE ON school_certificates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_school_certificates_lookup
  ON school_certificates (school_id, student_id, certificate_type, status);

-- 4. Clubs & Alumni
CREATE TABLE IF NOT EXISTS school_clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'sports'
    CHECK (category IN ('sports', 'arts', 'stem', 'literary', 'music', 'dance', 'robotics', 'environment', 'drama')),
  lead_teacher_id UUID REFERENCES staff(id) ON DELETE RESTRICT,
  description TEXT,
  max_members INT NOT NULL DEFAULT 40 CHECK (max_members >= 1),
  meeting_schedule VARCHAR(150),
  venue VARCHAR(100),
  status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_school_clubs_code UNIQUE (school_id, code),
  CONSTRAINT uq_school_clubs_school_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_school_clubs_updated_at
  BEFORE UPDATE ON school_clubs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS club_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  club_id UUID NOT NULL,
  student_id UUID NOT NULL,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  role VARCHAR(50) NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'captain', 'vice_captain', 'secretary', 'treasurer', 'mentor')),
  joined_on DATE NOT NULL DEFAULT CURRENT_DATE,
  achievements TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_club_memberships_student UNIQUE (club_id, student_id, academic_year_id),
  CONSTRAINT uq_club_memberships_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_club_memberships_club
    FOREIGN KEY (school_id, club_id) REFERENCES school_clubs(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_club_memberships_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_club_memberships_updated_at
  BEFORE UPDATE ON club_memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS alumni_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL,
  passing_year INT NOT NULL CHECK (passing_year >= 2000 AND passing_year <= 2100),
  class_graduated VARCHAR(50) NOT NULL DEFAULT 'Class 12',
  stream VARCHAR(50) DEFAULT 'Science',
  current_engagement VARCHAR(60) NOT NULL DEFAULT 'higher_education'
    CHECK (current_engagement IN ('higher_education', 'employed', 'entrepreneur', 'research', 'public_service', 'other')),
  institution_or_company VARCHAR(150),
  designation_or_course VARCHAR(150),
  contact_email VARCHAR(200),
  city VARCHAR(100),
  consent_for_directory BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_alumni_records_student UNIQUE (school_id, student_id),
  CONSTRAINT uq_alumni_records_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_alumni_records_student
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_alumni_records_updated_at
  BEFORE UPDATE ON alumni_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. Supabase Auth Interoperability Helper Functions
CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS UUID AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
    NULLIF(current_setting('app.user_id', true), '')::uuid
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_app_school_id() RETURNS UUID AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.school_id', true), '')::uuid,
    NULLIF(current_setting('app.school_id', true), '')::uuid
  );
$$ LANGUAGE sql STABLE;

-- 6. Grant Permissions & Apply Row-Level Security
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT USAGE ON SCHEMA public TO erp_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
  END IF;
END
$grants$;

DO $policies$
DECLARE
  tenant_table TEXT;
  policy_expression TEXT :=
    'school_id = COALESCE(NULLIF(current_setting(''request.jwt.claim.school_id'', true), '''')::uuid, NULLIF(current_setting(''app.school_id'', true), '''')::uuid)';
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'school_facilities',
    'facility_maintenance_tickets',
    'ptm_slots',
    'ptm_bookings',
    'school_certificates',
    'school_clubs',
    'club_memberships',
    'alumni_records'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tenant_table
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tenant_table);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (%s) WITH CHECK (%s)',
        tenant_table, policy_expression, policy_expression
      );
    END IF;
  END LOOP;
END
$policies$;


-- ----------------------------------------------------------------------------
-- Migration: 0035_activities_and_class_learning.sql (SHA-256: c213e36f3874a4abd159be8aae793aa28c25663399dda91636d11fe0143369e0)
-- ----------------------------------------------------------------------------

-- Additive activity records and teacher-reviewed, class-specific question papers.
CREATE TABLE activity_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL REFERENCES schools(id),
  club_id UUID NOT NULL, title VARCHAR(150) NOT NULL, kind VARCHAR(20) NOT NULL CHECK (kind IN ('session','competition')),
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, venue VARCHAR(100),
  created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), FOREIGN KEY(school_id,club_id) REFERENCES school_clubs(school_id,id),
  CHECK(ends_at > starts_at)
);
CREATE INDEX activity_sessions_calendar ON activity_sessions(school_id,starts_at);
CREATE TABLE activity_participation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL REFERENCES schools(id),
  session_id UUID NOT NULL, student_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL CHECK(status IN ('present','absent','excused')),
  house VARCHAR(60), score NUMERIC(10,2) CHECK(score >= 0), rank INTEGER CHECK(rank > 0), achievement VARCHAR(500),
  recorded_by UUID NOT NULL REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), UNIQUE(school_id,session_id,student_id),
  FOREIGN KEY(school_id,session_id) REFERENCES activity_sessions(school_id,id),
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id)
);
CREATE TABLE activity_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL REFERENCES schools(id),
  participation_id UUID NOT NULL, issued_by UUID NOT NULL REFERENCES users(id), issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(school_id,participation_id), FOREIGN KEY(school_id,participation_id) REFERENCES activity_participation(school_id,id)
);
CREATE TABLE enrichment_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL REFERENCES schools(id),
  grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 12), subject VARCHAR(100) NOT NULL, chapter VARCHAR(160) NOT NULL,
  topic VARCHAR(160) NOT NULL, kind VARCHAR(20) NOT NULL CHECK(kind IN ('objective','short','long','very_long')),
  question TEXT NOT NULL, answer TEXT NOT NULL, options JSONB NOT NULL DEFAULT '[]',
  difficulty VARCHAR(10) NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
  source_title VARCHAR(250) NOT NULL, source_url TEXT, as_of DATE, current_affairs BOOLEAN NOT NULL DEFAULT false,
  language VARCHAR(2) NOT NULL CHECK(language IN ('en','hi')), status VARCHAR(20) NOT NULL CHECK(status IN ('draft','published')),
  created_by UUID NOT NULL REFERENCES users(id), reviewed_by UUID REFERENCES users(id), reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), CHECK((status='published')=(reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK(NOT current_affairs OR (source_url IS NOT NULL AND as_of IS NOT NULL))
);
CREATE INDEX enrichment_questions_catalog ON enrichment_questions(school_id,grade,subject,status,language);
CREATE TABLE generated_question_papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL REFERENCES schools(id),
  title VARCHAR(160) NOT NULL, grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 12), subject VARCHAR(100) NOT NULL,
  language VARCHAR(2) NOT NULL CHECK(language IN ('en','hi')), variant VARCHAR(1) NOT NULL,
  total_marks INTEGER NOT NULL CHECK(total_marks>0), duration_minutes INTEGER NOT NULL,
  blueprint JSONB NOT NULL, questions JSONB NOT NULL, created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE learning_practice_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL REFERENCES schools(id),
  question_id UUID NOT NULL, user_id UUID NOT NULL REFERENCES users(id), response TEXT NOT NULL,
  correct BOOLEAN, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,question_id) REFERENCES enrichment_questions(school_id,id)
);
DO $policies$
DECLARE tenant_table TEXT;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['activity_sessions','activity_participation','activity_certificates','enrichment_questions','generated_question_papers','learning_practice_attempts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tenant_table);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = current_app_school_id()) WITH CHECK (school_id = current_app_school_id())',tenant_table);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO erp_app',tenant_table);
    END IF;
  END LOOP;
END $policies$;


-- ----------------------------------------------------------------------------
-- Migration: 0036_student_policy_reviews.sql (SHA-256: 0ffe3a00c585b555de553b44caee375f30725190972edb65dc5042d94fcdf657)
-- ----------------------------------------------------------------------------

CREATE TABLE student_policy_runtime (
  school_id UUID NOT NULL REFERENCES schools(id), state_code VARCHAR(2) NOT NULL,
  late_rule_id UUID REFERENCES fee_late_fee_rules(id), applied_version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(school_id,state_code)
);
CREATE TABLE student_lifecycle_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL REFERENCES schools(id), student_id UUID NOT NULL,
  enrollment_id UUID NOT NULL REFERENCES enrollments(id), academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  state_code VARCHAR(2) NOT NULL, policy JSONB NOT NULL, outstanding NUMERIC(12,2) NOT NULL CHECK(outstanding>0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','continued','withdrawn','readmitted')),
  created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES users(id), reviewed_at TIMESTAMPTZ, decision_note TEXT, authority_reference TEXT,
  readmitted_by UUID REFERENCES users(id), readmitted_at TIMESTAMPTZ, readmission_note TEXT,
  FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),
  UNIQUE(school_id,student_id,academic_year_id,state_code)
);
DO $policies$
DECLARE tenant_table TEXT;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['student_policy_runtime','student_lifecycle_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tenant_table);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = current_app_school_id()) WITH CHECK (school_id = current_app_school_id())',tenant_table);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO erp_app',tenant_table); END IF;
  END LOOP;
END $policies$;


-- ----------------------------------------------------------------------------
-- Migration: 0037_procurement_catalogue_and_cost_centres.sql (SHA-256: 4eeae3ff849b0e3d2d246930338163f3d8618fdf0d2f9e6f01854bde07233d4f)
-- ----------------------------------------------------------------------------

ALTER TABLE vendors
  ADD COLUMN category VARCHAR(40),
  ADD COLUMN service_type VARCHAR(30),
  ADD COLUMN secondary_phone VARCHAR(40),
  ADD COLUMN gstin VARCHAR(15),
  ADD COLUMN contract_starts_on DATE,
  ADD COLUMN contract_ends_on DATE,
  ADD CONSTRAINT chk_vendor_contract_dates CHECK(contract_starts_on IS NULL OR contract_ends_on IS NULL OR contract_ends_on>=contract_starts_on);
ALTER TABLE procurement_budgets
  ADD COLUMN expense_head_code VARCHAR(80),
  ADD COLUMN floor VARCHAR(80),
  ADD COLUMN vendor_id UUID,
  ADD CONSTRAINT fk_budget_vendor_same_school FOREIGN KEY(school_id,vendor_id) REFERENCES vendors(school_id,id);
CREATE UNIQUE INDEX uq_budget_head_cost_centre ON procurement_budgets(school_id,academic_year_id,expense_head_code,coalesce(department,''),coalesce(floor,''),coalesce(vendor_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE expense_head_code IS NOT NULL;
ALTER TABLE purchase_requests ADD COLUMN budget_id UUID,
  ADD CONSTRAINT fk_purchase_request_budget_same_school FOREIGN KEY(school_id,budget_id) REFERENCES procurement_budgets(school_id,id);
ALTER TABLE purchase_order_items
  ADD COLUMN expense_head_code VARCHAR(80),
  ADD COLUMN hsn_sac VARCHAR(8),
  ADD COLUMN gst_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(gst_percent BETWEEN 0 AND 100),
  ADD COLUMN gst_amount NUMERIC(16,2) GENERATED ALWAYS AS(round(quantity*unit_price*gst_percent/100,2)) STORED;


-- ----------------------------------------------------------------------------
-- Migration: 0038_institution_masters.sql (SHA-256: fddfd19504b32c9a8d2efbd1c3f98ffa6c074021e903746fce42523e6aeddff1)
-- ----------------------------------------------------------------------------

-- Additive reusable, tenant-owned master classifications. Existing text records remain valid.
CREATE TABLE institution_masters (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), school_id UUID NOT NULL REFERENCES schools(id),
 kind VARCHAR(60) NOT NULL CHECK(kind ~ '^[a-z][a-z0-9_]{1,59}$'),
 code VARCHAR(60) NOT NULL CHECK(code ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$'),
 label VARCHAR(120) NOT NULL CHECK(length(btrim(label))>0),
 institution_type VARCHAR(20) NOT NULL DEFAULT 'all' CHECK(institution_type IN('all','school','college','university')),
 active BOOLEAN NOT NULL DEFAULT true, notes TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id), UNIQUE(school_id,kind,institution_type,code)
);
CREATE UNIQUE INDEX institution_master_unique_label ON institution_masters(school_id,kind,institution_type,lower(label));
CREATE TRIGGER trg_institution_masters_updated BEFORE UPDATE ON institution_masters FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE staff_master_mapping (
 school_id UUID NOT NULL REFERENCES schools(id), staff_id UUID NOT NULL,
 institution_type VARCHAR(20) NOT NULL DEFAULT 'school' CHECK(institution_type IN('school','college','university')),
 staff_type_id UUID, designation_id UUID, department_id UUID, employment_type_id UUID,
 PRIMARY KEY(school_id,staff_id), FOREIGN KEY(school_id,staff_id) REFERENCES staff(school_id,id),
 FOREIGN KEY(school_id,staff_type_id) REFERENCES institution_masters(school_id,id),
 FOREIGN KEY(school_id,designation_id) REFERENCES institution_masters(school_id,id),
 FOREIGN KEY(school_id,department_id) REFERENCES institution_masters(school_id,id),
 FOREIGN KEY(school_id,employment_type_id) REFERENCES institution_masters(school_id,id)
);
CREATE FUNCTION seed_institution_masters(p_school_id UUID) RETURNS void LANGUAGE SQL AS $seed$
 INSERT INTO institution_masters(school_id,kind,code,label,institution_type)
 SELECT p_school_id,v.kind,v.code,v.label,v.institution_type FROM (VALUES
 ('staff_type','teaching','Teaching staff','all'),('staff_type','non_teaching','Non-teaching staff','all'),
 ('staff_type','management','Management / governance','all'),('staff_type','contract','Contract / outsourced staff','all'),
 ('staff_type','visiting','Visiting / guest faculty','all'),
 ('designation','principal','Principal','school'),('designation','vice_principal','Vice Principal','school'),
 ('designation','head_teacher','Head Teacher','school'),('designation','teacher','Teacher','school'),
 ('designation','coordinator','Academic Coordinator','all'),('designation','administrator','Institution Administrator','all'),
 ('designation','accountant','Accountant / Fee Collector','all'),('designation','librarian','Librarian','all'),
 ('designation','lab_technician','Lab Technician','all'),('designation','counsellor','Counsellor','all'),
 ('designation','nurse','School / Campus Nurse','all'),('designation','driver','Driver','all'),
 ('designation','housekeeping','Housekeeping / Support','all'),('designation','security','Security Staff','all'),
 ('designation','professor','Professor','all'),('designation','associate_professor','Associate Professor','all'),
 ('designation','assistant_professor','Assistant Professor','all'),('designation','lecturer','Lecturer','college'),
 ('designation','dean','Dean','all'),('designation','registrar','Registrar','all'),
 ('designation','vice_chancellor','Vice Chancellor','university'),('designation','hod','Head of Department','all'),
 ('department','academics','Academics','all'),('department','administration','Administration','all'),
 ('department','finance','Finance / Fee Collection','all'),('department','hr','Human Resources','all'),
 ('department','library','Library','all'),('department','it','IT / Communication','all'),
 ('department','transport','Transport','all'),('department','sports','Sports / Activities','all'),
 ('department','facilities','Facilities / Maintenance','all'),('department','student_services','Student Services','all'),
 ('employment_type','permanent','Permanent','all'),('employment_type','contract','Contract','all'),
 ('employment_type','part_time','Part-time','all'),('employment_type','visiting','Visiting / Guest','all'),
 ('employment_type','temporary','Temporary','all')
 ) AS v(kind,code,label,institution_type) ON CONFLICT DO NOTHING;
$seed$;
SELECT seed_institution_masters(id) FROM schools;
DO $policies$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['institution_masters','staff_master_mapping'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(school_id=current_app_school_id()) WITH CHECK(school_id=current_app_school_id())',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO erp_app',t); END IF;
 END LOOP;
END $policies$;


-- ----------------------------------------------------------------------------
-- Migration: 0039_fee_collection_scope.sql (SHA-256: ad0e6026e44314f59a7946f196f447aea5b997dde556509cebfd2874c5851aea)
-- ----------------------------------------------------------------------------

ALTER TABLE fee_offline_payment_acknowledgements ADD COLUMN collector_user_id UUID REFERENCES users(id);
CREATE UNIQUE INDEX staff_collection_unique_reference ON fee_offline_payment_acknowledgements(school_id,collector_user_id,student_id,reference_number) WHERE collector_user_id IS NOT NULL;
INSERT INTO permissions(code,description) VALUES('access.roles.inspect','Inspect person roles, scopes and module permissions'),('fees.collection.record','Record scoped fee collections for independent finance verification') ON CONFLICT(code) DO NOTHING;
INSERT INTO roles(code,name,description) VALUES
 ('management','Management / Trustees','Read-only institutional oversight'),
 ('principal','Principal / Head of Institution','Academic and institution policy leadership'),
 ('school_admin','School / College / University Administrator','Institution operations and user administration'),
 ('teacher_fee_collector','Assigned Teacher Fee Collector','Supplemental collection responsibility within assigned scope'),
 ('central_fee_collector','Central Fee Collection Desk','Central collection with independent verification') ON CONFLICT(code) DO NOTHING;
-- Existing accounts receive no new assignments. Add permissions to the new presets only.
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON
 (r.code='teacher_fee_collector' AND p.code IN('school.view','fees.collection.record')) OR
 (r.code='central_fee_collector' AND p.code IN('school.view','fees.collection.record')) OR
 (r.code='management' AND p.code IN('school.view','academic.structure.view','students.profile.view','attendance.register.view','fees.view','exams.view','hr.employee.view','procurement.view','transport.view','library.view','learning.view','concerns.view','notices.view','audit.view','reports.export','access.roles.inspect')) OR
 (r.code='school_admin' AND p.code IN('school.view','school.manage','academic.structure.view','academic.year.manage','academic.class.manage','academic.section.manage','academic.subject.manage','academic.timetable.manage','students.profile.view','students.profile.edit','students.admission.create','students.guardian.manage','attendance.register.view','attendance.correction.approve','hr.employee.view','hr.employee.manage','procurement.view','procurement.request','procurement.vendor.manage','transport.view','library.view','learning.view','notices.view','notices.manage','access.roles.manage','access.roles.inspect','audit.view','reports.export'))
 ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT principal.id,rp.permission_id FROM roles principal JOIN roles coord ON coord.code='academic_coordinator' JOIN role_permissions rp ON rp.role_id=coord.id WHERE principal.code='principal' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN('school.manage','students.profile.edit','procurement.view','procurement.approve','audit.view','access.roles.inspect') WHERE r.code='principal' ON CONFLICT DO NOTHING;

CREATE TABLE institution_operating_policy (
 school_id UUID PRIMARY KEY REFERENCES schools(id), policy JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 updated_by UUID NOT NULL REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE institution_operating_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON institution_operating_policy USING(school_id=current_app_school_id()) WITH CHECK(school_id=current_app_school_id());
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN GRANT SELECT,INSERT,UPDATE ON institution_operating_policy TO erp_app; END IF; END $$;

ALTER TABLE attendance_shortage_cases DROP CONSTRAINT IF EXISTS attendance_shortage_cases_board_exam_eligibility_check;
ALTER TABLE attendance_shortage_cases ADD CONSTRAINT attendance_shortage_cases_board_exam_eligibility_check CHECK(board_exam_eligibility IN('eligible','condonation_submitted','condoned_by_board','ineligible','not_applicable','under_review'));


-- ----------------------------------------------------------------------------
-- Migration: 0040_library_class_catalogue.sql (SHA-256: d63cead27d05d5fb2f7e70bd8aa75e45207710179776f7a58ad64bbb1760e21c)
-- ----------------------------------------------------------------------------

ALTER TABLE library_books ADD COLUMN book_type VARCHAR(30) NOT NULL DEFAULT 'unclassified' CHECK(book_type IN('academic','non_academic','reference','periodical','unclassified'));
ALTER TABLE library_books ADD COLUMN edition VARCHAR(80), ADD COLUMN subject_id UUID, ADD COLUMN source_url VARCHAR(1000);
ALTER TABLE library_books ADD CONSTRAINT library_book_subject_fk FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id);
CREATE TABLE library_book_classes(school_id UUID NOT NULL REFERENCES schools(id),book_id UUID NOT NULL,class_id UUID NOT NULL,
 PRIMARY KEY(school_id,book_id,class_id),FOREIGN KEY(school_id,book_id) REFERENCES library_books(school_id,id),FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id));
ALTER TABLE library_book_classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON library_book_classes USING(school_id=current_app_school_id()) WITH CHECK(school_id=current_app_school_id());
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN GRANT SELECT,INSERT,DELETE ON library_book_classes TO erp_app; END IF; END $$;
CREATE FUNCTION seed_library_categories(p_school UUID) RETURNS void LANGUAGE SQL AS $seed$
 INSERT INTO library_categories(school_id,code,name) SELECT p_school,v.code,v.name FROM (VALUES
 ('ACADEMIC_TEXTBOOKS','Academic textbooks'),('ACADEMIC_WORKBOOKS','Workbooks & practice'),('REFERENCE_GENERAL','Reference & encyclopedias'),
 ('GK_CURRENT','General knowledge & current affairs'),('STORIES_FICTION','Stories & fiction'),('LANGUAGE_READING','Language & reading'),
 ('SCIENCE_TECH','Science & technology'),('MATH_LOGIC','Mathematics & reasoning'),('SOCIAL_STUDIES','History, geography & civics'),
 ('ARTS_CULTURE','Arts, music & culture'),('SPORTS_WELLNESS','Sports & wellbeing'),('BIOGRAPHIES','Biographies & inspiration'),
 ('CAREER_SKILLS','Careers & life skills'),('PERIODICALS','Magazines & periodicals'),('TEACHER_RESOURCES','Teacher reference resources')
 )v(code,name) ON CONFLICT(school_id,code) DO NOTHING;
$seed$;
SELECT seed_library_categories(id) FROM schools;


-- ----------------------------------------------------------------------------
-- Migration: 0041_transport_audit_masters.sql (SHA-256: da82a5a7ff5e536982d3c718aa8adc82197ad9c72c53359e8a90916f8dcb9d2e)
-- ----------------------------------------------------------------------------

CREATE TABLE transport_vehicle_profiles (
 school_id UUID NOT NULL REFERENCES schools(id), vehicle_id UUID NOT NULL,
 model_id UUID, vehicle_type_id UUID, fuel_type_id UUID, audit_details JSONB NOT NULL DEFAULT '{}',
 PRIMARY KEY(school_id,vehicle_id), FOREIGN KEY(school_id,vehicle_id) REFERENCES transport_vehicles(school_id,id),
 FOREIGN KEY(school_id,model_id) REFERENCES institution_masters(school_id,id),
 FOREIGN KEY(school_id,vehicle_type_id) REFERENCES institution_masters(school_id,id),
 FOREIGN KEY(school_id,fuel_type_id) REFERENCES institution_masters(school_id,id)
);
ALTER TABLE transport_maintenance ALTER COLUMN performed_on DROP NOT NULL;
ALTER TABLE transport_maintenance ADD COLUMN planned_on DATE, ADD COLUMN vendor_id UUID, ADD COLUMN expense_id UUID, ADD COLUMN audit_details JSONB NOT NULL DEFAULT '{}';
ALTER TABLE transport_maintenance ADD CONSTRAINT maintenance_vendor_fk FOREIGN KEY(school_id,vendor_id) REFERENCES vendors(school_id,id), ADD CONSTRAINT maintenance_expense_fk FOREIGN KEY(school_id,expense_id) REFERENCES procurement_expenses(school_id,id);
CREATE FUNCTION seed_transport_masters(p_school UUID) RETURNS void LANGUAGE SQL AS $seed$
 INSERT INTO institution_masters(school_id,kind,code,label,institution_type,notes) SELECT p_school,v.kind,v.code,v.label,'all',v.notes FROM (VALUES
 ('vehicle_type','school_bus','School bus','Verify usage and RC class'),('vehicle_type','mini_bus','Mini bus','Verify usage and RC class'),('vehicle_type','van','Van / traveller','Verify usage and RC class'),('vehicle_type','non_transport','Non-transport / staff vehicle','Not automatically approved for student transport'),
 ('fuel_type','diesel','Diesel',''),('fuel_type','petrol','Petrol',''),('fuel_type','cng','CNG',''),('fuel_type','electric','Electric',''),('fuel_type','lpg','LPG',''),('fuel_type','hybrid','Hybrid',''),
 ('vehicle_model','tata_starbus','Tata Starbus','https://busesandvans.tatamotors.com/brand/starbus'),
 ('vehicle_model','ashok_sunshine','Ashok Leyland Sunshine','https://www.ashokleyland.com/in/buses/brands/sunshine'),
 ('vehicle_model','force_traveller','Force Traveller N School Bus','https://www.forcemotors.com/vehicles/school-buses/'),
 ('vehicle_model','eicher_skyline','Eicher Skyline Pro Next','https://www.eichertrucksandbuses.com/buses/school-bus/skyline-pro'),
 ('maintenance_type','periodic_service','Periodic servicing',''),('maintenance_type','repair','Mechanical / electrical repair',''),('maintenance_type','tyres','Tyres / alignment',''),('maintenance_type','brakes','Brakes / safety inspection',''),('maintenance_type','bodywork','Body / accident repair',''),('maintenance_type','inspection','Fitness / permit / PUC inspection',''),('maintenance_type','battery','Battery / charging system',''),('maintenance_type','cleaning','Cleaning / sanitation','')
 )v(kind,code,label,notes) ON CONFLICT DO NOTHING;
$seed$;
SELECT seed_transport_masters(id) FROM schools;
ALTER TABLE transport_vehicle_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transport_vehicle_profiles USING(school_id=current_app_school_id()) WITH CHECK(school_id=current_app_school_id());
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN GRANT SELECT,INSERT,UPDATE ON transport_vehicle_profiles TO erp_app; END IF; END $$;


-- ----------------------------------------------------------------------------
-- Migration: 0042_transport_tariffs_and_renewals.sql (SHA-256: ae2d92b96b3b9bb9abb9de95d2a1df5d27f8fee8dd2b6fd84324d5ff290e85a1)
-- ----------------------------------------------------------------------------

ALTER TABLE student_transport_allocations ADD COLUMN valid_until DATE, ADD COLUMN reminder_days INTEGER NOT NULL DEFAULT 60 CHECK(reminder_days BETWEEN 1 AND 180);
ALTER TABLE student_transport_allocations ADD CONSTRAINT transport_validity_dates CHECK(valid_until IS NULL OR valid_until>=effective_from);
CREATE TABLE transport_tariffs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),school_id UUID NOT NULL REFERENCES schools(id),route_id UUID NOT NULL,fee_head_id UUID NOT NULL,
 period VARCHAR(20) NOT NULL CHECK(period IN('monthly','term','annual','one_time')),amount NUMERIC(12,2) NOT NULL CHECK(amount>=0),
 effective_from DATE NOT NULL,effective_to DATE,active BOOLEAN NOT NULL DEFAULT true,authority_reference VARCHAR(200),
 created_by UUID NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),FOREIGN KEY(school_id,route_id) REFERENCES transport_routes(school_id,id),FOREIGN KEY(school_id,fee_head_id) REFERENCES fee_heads(school_id,id),
 CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE TABLE transport_renewal_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),school_id UUID NOT NULL REFERENCES schools(id),allocation_id UUID NOT NULL,
 requested_until DATE NOT NULL,requested_by UUID NOT NULL REFERENCES users(id),reason VARCHAR(500),status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
 reviewed_by UUID REFERENCES users(id),reviewed_at TIMESTAMPTZ,review_note VARCHAR(500),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),FOREIGN KEY(school_id,allocation_id) REFERENCES student_transport_allocations(school_id,id)
);
CREATE UNIQUE INDEX transport_one_pending_renewal ON transport_renewal_requests(school_id,allocation_id) WHERE status='pending';
DO $policies$ DECLARE t TEXT; BEGIN FOREACH t IN ARRAY ARRAY['transport_tariffs','transport_renewal_requests'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(school_id=current_app_school_id()) WITH CHECK(school_id=current_app_school_id())',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO erp_app',t); END IF; END LOOP; END $policies$;
INSERT INTO fee_heads(school_id,code,name,description) SELECT id,'TRANSPORT','Transport fee','Route tariff mapping; charges remain in the central fee ledger' FROM schools ON CONFLICT(school_id,code) DO NOTHING;


-- ----------------------------------------------------------------------------
-- Migration: 0043_academic_supplemental_profiles.sql (SHA-256: 1350b30058b2ac0b0fab0d81f47f839ce76fa755f9a273328d04e91232573ca2)
-- ----------------------------------------------------------------------------

-- Additive academic profiles; no existing classes/sections/enrollments are rewritten.
CREATE TABLE academic_class_profiles (
 school_id UUID NOT NULL REFERENCES schools(id), class_id UUID NOT NULL,
 stage_id UUID, medium_id UUID, stream VARCHAR(120), coordinator_user_id UUID REFERENCES users(id), next_class_id UUID,
 updated_by UUID NOT NULL REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,class_id), FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id),
 FOREIGN KEY(school_id,stage_id) REFERENCES institution_masters(school_id,id),
 FOREIGN KEY(school_id,medium_id) REFERENCES institution_masters(school_id,id),
 FOREIGN KEY(school_id,next_class_id) REFERENCES classes(school_id,id), CHECK(next_class_id IS NULL OR next_class_id<>class_id)
);
CREATE TABLE academic_section_profiles (
 school_id UUID NOT NULL REFERENCES schools(id), section_id UUID NOT NULL,
 class_teacher_user_id UUID REFERENCES users(id), co_teacher_user_id UUID REFERENCES users(id),
 room_id UUID, shift_id UUID, medium_id UUID, stream VARCHAR(120), next_section_id UUID,
 updated_by UUID NOT NULL REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,section_id), FOREIGN KEY(school_id,section_id) REFERENCES sections(school_id,id),
 FOREIGN KEY(school_id,room_id) REFERENCES rooms(school_id,id),
 FOREIGN KEY(school_id,shift_id) REFERENCES institution_masters(school_id,id),
 FOREIGN KEY(school_id,medium_id) REFERENCES institution_masters(school_id,id),
 FOREIGN KEY(school_id,next_section_id) REFERENCES sections(school_id,id), CHECK(next_section_id IS NULL OR next_section_id<>section_id),
 CHECK(class_teacher_user_id IS NULL OR co_teacher_user_id IS NULL OR class_teacher_user_id<>co_teacher_user_id)
);
CREATE FUNCTION seed_academic_profile_masters(p_school UUID) RETURNS void LANGUAGE SQL AS $seed$
 INSERT INTO institution_masters(school_id,kind,code,label,institution_type) SELECT p_school,v.kind,v.code,v.label,'all' FROM (VALUES
 ('academic_stage','foundational','Foundational / pre-primary'),('academic_stage','primary','Primary'),('academic_stage','middle','Middle'),('academic_stage','secondary','Secondary'),('academic_stage','senior_secondary','Senior secondary'),('academic_stage','higher_education','Higher education'),
 ('language_medium','english','English'),('language_medium','hindi','Hindi'),('language_medium','bilingual','Bilingual'),('language_medium','regional','Regional language — specify in notes'),
 ('academic_shift','morning','Morning'),('academic_shift','afternoon','Afternoon'),('academic_shift','full_day','Full day'),('academic_shift','evening','Evening')
 )v(kind,code,label) ON CONFLICT DO NOTHING;
$seed$;
SELECT seed_academic_profile_masters(id) FROM schools;
DO $policies$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['academic_class_profiles','academic_section_profiles'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(school_id=current_app_school_id()) WITH CHECK(school_id=current_app_school_id())',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO erp_app',t); END IF;
 END LOOP;
END $policies$;

-- Every future institution receives the same idempotent reference masters.
CREATE FUNCTION seed_new_institution_reference_masters() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM seed_institution_masters(NEW.id);
 PERFORM seed_library_categories(NEW.id);
 PERFORM seed_transport_masters(NEW.id);
 PERFORM seed_academic_profile_masters(NEW.id);
 INSERT INTO fee_heads(school_id,code,name,description,status)
 VALUES(NEW.id,'TRANSPORT','Transport Fee','Approved route/subscription transport charges','active')
 ON CONFLICT(school_id,code) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_new_institution_reference_masters AFTER INSERT ON schools
 FOR EACH ROW EXECUTE FUNCTION seed_new_institution_reference_masters();

-- Shared date constraints also protect the existing HR holiday entry point.
CREATE FUNCTION assert_academic_plan_date_bounds() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE year_start DATE; year_end DATE;
BEGIN
 IF NEW.academic_year_id IS NULL THEN RETURN NEW; END IF;
 SELECT starts_on,ends_on INTO year_start,year_end FROM academic_years
 WHERE school_id=NEW.school_id AND id=NEW.academic_year_id FOR SHARE;
 IF year_start IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Academic year not found for this institution'; END IF;
 IF TG_TABLE_NAME='terms' THEN
  IF NEW.starts_on<year_start OR NEW.ends_on>year_end THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Term dates must fall inside the academic year'; END IF;
 ELSE
  IF NEW.holiday_on<year_start OR NEW.holiday_on>year_end THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Year holiday must fall inside the academic year'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_terms_date_bounds BEFORE INSERT OR UPDATE OF starts_on,ends_on,academic_year_id,school_id ON terms
 FOR EACH ROW EXECUTE FUNCTION assert_academic_plan_date_bounds();
CREATE TRIGGER trg_holidays_date_bounds BEFORE INSERT OR UPDATE OF holiday_on,academic_year_id,school_id ON holidays
 FOR EACH ROW EXECUTE FUNCTION assert_academic_plan_date_bounds();
CREATE FUNCTION assert_academic_year_plan_bounds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM terms WHERE school_id=NEW.school_id AND academic_year_id=NEW.id AND (starts_on<NEW.starts_on OR ends_on>NEW.ends_on))
 OR EXISTS(SELECT 1 FROM holidays WHERE school_id=NEW.school_id AND academic_year_id=NEW.id AND (holiday_on<NEW.starts_on OR holiday_on>NEW.ends_on)) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Academic year dates would exclude a recorded term or year holiday';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_academic_year_plan_bounds BEFORE UPDATE OF starts_on,ends_on ON academic_years
 FOR EACH ROW EXECUTE FUNCTION assert_academic_year_plan_bounds();


-- ----------------------------------------------------------------------------
-- Migration: 0044_subject_class_offerings.sql (SHA-256: 757ec7ba5311e07d74262cc6824c7dccd8d70c8f510d45e7d9633dbd634039f8)
-- ----------------------------------------------------------------------------

-- Explicit academic offerings, independent of teacher allocation and timetable entries.
CREATE TABLE subject_class_offerings (
 school_id UUID NOT NULL REFERENCES schools(id),
 academic_year_id UUID NOT NULL,
 subject_id UUID NOT NULL,
 class_id UUID NOT NULL,
 updated_by UUID NOT NULL REFERENCES users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,academic_year_id,subject_id,class_id),
 FOREIGN KEY(school_id,academic_year_id) REFERENCES academic_years(school_id,id),
 FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id),
 FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id)
);
ALTER TABLE subject_class_offerings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subject_class_offerings
 USING(school_id=current_app_school_id()) WITH CHECK(school_id=current_app_school_id());
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON subject_class_offerings TO erp_app;
END IF; END $$;


-- ----------------------------------------------------------------------------
-- Migration: 0045_admission_details.sql (SHA-256: 0fd6bc93ddafd9b36fc4e74726cb60e625d607fb9b65862b5811c851ae3a4a53)
-- ----------------------------------------------------------------------------

-- Expand student admission profiles while keeping school-specific records tenant scoped.
ALTER TABLE students
  ADD COLUMN gender VARCHAR(30),
  ADD COLUMN aadhaar_last4 CHAR(4),
  ADD COLUMN previous_class VARCHAR(80),
  ADD COLUMN previous_school_name VARCHAR(160),
  ADD COLUMN home_address TEXT,
  ADD COLUMN city VARCHAR(100),
  ADD COLUMN state VARCHAR(100),
  ADD COLUMN postal_code VARCHAR(12),
  ADD COLUMN medical_information TEXT,
  ADD COLUMN admission_documents JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT chk_students_gender CHECK (gender IS NULL OR gender IN ('female', 'male', 'other', 'not_disclosed')),
  ADD CONSTRAINT chk_students_aadhaar_last4 CHECK (aadhaar_last4 IS NULL OR aadhaar_last4 ~ '^[0-9]{4}$'),
  ADD CONSTRAINT chk_students_postal_code CHECK (postal_code IS NULL OR postal_code ~ '^[1-9][0-9]{5}$');

ALTER TABLE guardians
  ADD COLUMN occupation VARCHAR(120);

-- Migration: 0046_notice_metadata.sql
ALTER TABLE notices
  ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT 'general',
  ADD COLUMN priority VARCHAR(12) NOT NULL DEFAULT 'normal',
  ADD CONSTRAINT chk_notices_category CHECK (category IN (
    'general', 'academic', 'examination', 'holiday', 'fee', 'attendance',
    'parent_meeting', 'school_event', 'competition', 'admission', 'transport',
    'library', 'health_safety', 'achievement', 'staff', 'emergency'
  )),
  ADD CONSTRAINT chk_notices_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

CREATE INDEX ix_notices_school_category_priority
  ON notices (school_id, category, priority, created_at DESC);

-- ============================================================================
-- RECORD ALL 35 MIGRATION CHECKSUMS IN schema_migrations
-- ============================================================================
INSERT INTO schema_migrations (version, checksum, applied_at)
VALUES
  ('0001_foundation.sql', '23a5cbbbdf1753343cd42078a9909ca10f1c5989872d198396e982dfc50f70a3', now()),
  ('0002_academic.sql', '1106f6b2e92df09d0888618456f258356994fdf4b0bc281cae2bde0d0a6a5e72', now()),
  ('0003_students.sql', '639416fa8654d67ffea2229a34b5c377748e12932e9e7aeac1ab5525d487f318', now()),
  ('0004_integrity.sql', '2b5b7dc63ced89f55e6334e71877d62b30f0e3d01552dca0c992ba8dc2bc549e', now()),
  ('0005_attendance.sql', '2f8bc5b5ab422295c4bc85e3eacff4ad4da476f57d5c5e6d4921c25d5fd80ee3', now()),
  ('0006_timetable.sql', '182628f322b6ca4b2839ea789ef731c82fd7cc6c54fc69c0c68b7fc110e7f456', now()),
  ('0007_fees.sql', 'e68061c303c14c009c3d468d009371b29ecb77b8db26dc30f5dc6ddd1186b315', now()),
  ('0008_exams.sql', '18c72661108f4085c05d380fcd40b4ae1fca2c2fdeab5301d807508c213807ab', now()),
  ('0009_staff.sql', '4e15291dc3854f661af35e1dbea69ca0f6635f9ec6193f25ae03d37e0d43e88b', now()),
  ('0010_notices.sql', '6b22240a509a04b81e1e0819a122a2be489320c5fdee263543ad2159ae80fe76', now()),
  ('0011_notice_files.sql', 'de671cd0a2cce1e8ace6d7be60e130d0a7620e9f9b501d0defa7e525df824903', now()),
  ('0012_safeguarding.sql', 'bd598c4625069783d60ab962c1358574b915aaf47138e6e5b721b8cc3abe6362', now()),
  ('0013_leave_config.sql', 'f573c49f56fd10e37e7055d2f5868435b054ce21f893a969e33d8acb2152c16d', now()),
  ('0014_payroll.sql', 'dcccb104072d78293a24dd707061676c5ba15d789e8c036d762f1af734e873ef', now()),
  ('0015_fee_plans.sql', '143ef0c3a2718141a20181074f69b913656feaba4bc7dbff1dded75de0f82e7d', now()),
  ('0016_auth_security.sql', 'aa2f19159e07e3babdb8503125bdce85d5b074798882229cc665ef7d164f1938', now()),
  ('0017_idempotency.sql', '47cfe044b83b8c04b32b41cfb7cd9d399dbdf07a879f07382dbb105828bf1d7b', now()),
  ('0018_rls.sql', 'dc3fdbb7efba4664b4598bba64a0b8cbd82432221d2ec72e278a26035045c90e', now()),
  ('0019_staff_attendance.sql', '368281a8c9003a74cb112db8f284f6eb46fe2a4a2f404fc2c400a8b4e167120c', now()),
  ('0020_recruitment.sql', '9ad48b845c9e0d01fd689f929b8a553a8c9770e8dd4ccec281f6f10b541e6c3c', now()),
  ('0021_procurement.sql', '21a3395799f1c263f411486f4234cb4a46f7213e9de2471e1d0ae1cc553a58ef', now()),
  ('0022_transport.sql', '31b114c200eb09c0f29f933399d94930751da1ddeb1418caf5d79d353c06a9a0', now()),
  ('0023_library.sql', '0e32055cefac25b40fc6ae5a6c9dd446082a86256995bb2e6f5ea0404504c8e0', now()),
  ('0024_learning.sql', 'aec3b009bbe79e4f17d6d245ea4fa430cc07c3f0ecfe52dac59169eb76958601', now()),
  ('0025_concerns.sql', '34c16abb5ba24228791f19a1e661187cb4ddbdb420d4532744de274a83020190', now()),
  ('0026_notifications.sql', '41548cc7b98164982974079914caaba93be716601d5438d3090e1cb005a52e32', now()),
  ('0027_fee_reconciliation.sql', '659be52f0c612782be68da1591e0450d40d229d2ddb20697ac45550d4a2cb56a', now()),
  ('0028_saved_reports_imports.sql', 'f2305fa18b6f066d0643a47722aa1cc71b15e8cf617b48a65de094831cc254a8', now()),
  ('0029_rls_extension.sql', '861d86bc7c920306c9ff4aaf4c6613c6474a5e2bcf8534a3023bd09d44774ae0', now()),
  ('0030_transport_stop_retirement.sql', 'c33375bf6fd020549fbb1814d3e5390fcf0cd92a641ae447461108a4de6a2f8d', now()),
  ('0031_rang_biranga_core.sql', 'f29b5d648d8c44f362b94c3a9f65aaad643389d96fa04f1a379edb8f9b6432c2', now()),
  ('0032_parent_student_advanced_attendance.sql', 'd0e01f02467258a5f05b8f048eac56a299d6a9f94cd8cbb25ca766c3d82d199e', now()),
  ('0033_geo_face_staff_attendance.sql', 'c7957853686e289bfa1f296faba1856bf9b992c8cf232f168f4862fce568025b', now()),
  ('0034_complete_school_erp_and_supabase.sql', '9b41a04b660697eb6ca18cf95158368193f29adf7ee6efd77f609466dfee316f', now()),
  ('0035_activities_and_class_learning.sql', 'c213e36f3874a4abd159be8aae793aa28c25663399dda91636d11fe0143369e0', now()),
  ('0036_student_policy_reviews.sql', '0ffe3a00c585b555de553b44caee375f30725190972edb65dc5042d94fcdf657', now()),
  ('0037_procurement_catalogue_and_cost_centres.sql', '4eeae3ff849b0e3d2d246930338163f3d8618fdf0d2f9e6f01854bde07233d4f', now()),
  ('0038_institution_masters.sql', 'fddfd19504b32c9a8d2efbd1c3f98ffa6c074021e903746fce42523e6aeddff1', now()),
  ('0039_fee_collection_scope.sql', 'ad0e6026e44314f59a7946f196f447aea5b997dde556509cebfd2874c5851aea', now()),
  ('0040_library_class_catalogue.sql', 'd63cead27d05d5fb2f7e70bd8aa75e45207710179776f7a58ad64bbb1760e21c', now()),
  ('0041_transport_audit_masters.sql', 'da82a5a7ff5e536982d3c718aa8adc82197ad9c72c53359e8a90916f8dcb9d2e', now()),
  ('0042_transport_tariffs_and_renewals.sql', 'ae2d92b96b3b9bb9abb9de95d2a1df5d27f8fee8dd2b6fd84324d5ff290e85a1', now()),
  ('0043_academic_supplemental_profiles.sql', '1350b30058b2ac0b0fab0d81f47f839ce76fa755f9a273328d04e91232573ca2', now()),
  ('0044_subject_class_offerings.sql', '757ec7ba5311e07d74262cc6824c7dccd8d70c8f510d45e7d9633dbd634039f8', now()),
  ('0045_admission_details.sql', '0fd6bc93ddafd9b36fc4e74726cb60e625d607fb9b65862b5811c851ae3a4a53', now()),
  ('0046_notice_metadata.sql', '4867537e68814ff489648c0dc665ab2eacd06cc55206b420f1e433b67c3c7088', now())
ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum;

-- Grant full schema privileges to Supabase authenticated and erp_app roles
GRANT USAGE ON SCHEMA public TO erp_app, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO erp_app, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO erp_app, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO erp_app, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO erp_app, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO erp_app, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO erp_app, authenticated, service_role;
