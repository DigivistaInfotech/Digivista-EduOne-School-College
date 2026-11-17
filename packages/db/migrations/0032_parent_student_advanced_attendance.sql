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
