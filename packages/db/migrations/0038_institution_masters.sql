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
