-- Expand student admission profiles while keeping school-specific records tenant scoped.
ALTER TABLE students
  ADD COLUMN gender VARCHAR(30),
  ADD COLUMN aadhaar_last4 CHAR(4),
  ADD COLUMN previous_class VARCHAR(80),
  ADD COLUMN previous_school_name VARCHAR(160),
  ADD COLUMN home_address TEXT,
  ADD COLUMN city VARCHAR(100),
  ADD COLUMN state VARCHAR(100),
  ADD COLUMN postal_code VARCHAR(12),
  ADD COLUMN medical_information TEXT,
  ADD COLUMN admission_documents JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT chk_students_gender CHECK (gender IS NULL OR gender IN ('female', 'male', 'other', 'not_disclosed')),
  ADD CONSTRAINT chk_students_aadhaar_last4 CHECK (aadhaar_last4 IS NULL OR aadhaar_last4 ~ '^[0-9]{4}$'),
  ADD CONSTRAINT chk_students_postal_code CHECK (postal_code IS NULL OR postal_code ~ '^[1-9][0-9]{5}$');

ALTER TABLE guardians
  ADD COLUMN occupation VARCHAR(120);
