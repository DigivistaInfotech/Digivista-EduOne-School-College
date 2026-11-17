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
