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
