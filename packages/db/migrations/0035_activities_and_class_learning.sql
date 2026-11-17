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
