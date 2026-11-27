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
