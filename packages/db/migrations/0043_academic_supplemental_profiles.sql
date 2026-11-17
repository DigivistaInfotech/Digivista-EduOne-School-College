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
