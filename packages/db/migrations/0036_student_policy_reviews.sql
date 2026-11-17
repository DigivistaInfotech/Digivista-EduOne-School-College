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
