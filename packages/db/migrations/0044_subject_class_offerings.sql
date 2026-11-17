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
