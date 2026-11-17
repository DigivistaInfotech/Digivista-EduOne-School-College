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
