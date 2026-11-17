-- 0033 Geo-Fenced, Face-Verified Staff Biometric Attendance System
--
-- Implements secure, configurable attendance for all authorised employees and
-- personnel (teaching, non-teaching, administrative, management, accounts,
-- transport, etc.), explicitly excluding students from mandatory biometric punch.
-- Includes geofencing, facial biometric enrolment & consent, liveness verification,
-- punch-in/out state management, manual exception requests, and dedicated kiosks.

-- 1. School Geofences (Campuses, grounds, transport depots & approved off-site locations)
CREATE TABLE IF NOT EXISTS school_geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  campus_id UUID REFERENCES campuses(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  location_type VARCHAR(40) NOT NULL DEFAULT 'campus'
    CHECK (location_type IN ('campus', 'sports_ground', 'transport_depot', 'approved_offsite', 'event_venue')),
  latitude NUMERIC(10, 7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(10, 7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_meters INTEGER NOT NULL DEFAULT 150 CHECK (radius_meters BETWEEN 20 AND 5000),
  max_accuracy_threshold_meters INTEGER NOT NULL DEFAULT 100 CHECK (max_accuracy_threshold_meters BETWEEN 10 AND 500),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_school_geofences_school_name UNIQUE (school_id, name),
  CONSTRAINT uq_school_geofences_school_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_school_geofences_updated_at
  BEFORE UPDATE ON school_geofences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_school_geofences_active
  ON school_geofences (school_id, is_active);

-- 2. Staff Biometric Profiles (Consent, Mathematical Template Embeddings & Enrolment Status)
CREATE TABLE IF NOT EXISTS staff_biometric_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  consent_given BOOLEAN NOT NULL DEFAULT FALSE,
  consent_version VARCHAR(40) NOT NULL DEFAULT 'v1.0-dpdpa',
  consent_given_at TIMESTAMPTZ,
  consent_withdrawn_at TIMESTAMPTZ,
  enrolment_status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (enrolment_status IN ('pending', 'enrolled', 'withdrawn', 'suspended')),
  enrolled_at TIMESTAMPTZ,
  enrolled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  template_algorithm VARCHAR(60) NOT NULL DEFAULT 'face_emb_v1_512',
  template_data_encrypted TEXT,
  template_hash VARCHAR(64) NOT NULL,
  photo_verification_hash VARCHAR(64),
  quality_score NUMERIC(5, 2) CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_biometric_staff UNIQUE (school_id, staff_id),
  CONSTRAINT uq_staff_biometric_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_staff_biometric_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_staff_biometric_updated_at
  BEFORE UPDATE ON staff_biometric_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_staff_biometric_lookup
  ON staff_biometric_profiles (school_id, staff_id, enrolment_status);

-- 3. Dedicated Attendance Kiosks (School-owned managed entrance tablets/devices)
CREATE TABLE IF NOT EXISTS attendance_kiosks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  campus_id UUID REFERENCES campuses(id) ON DELETE RESTRICT,
  device_code VARCHAR(60) NOT NULL,
  device_name VARCHAR(160) NOT NULL,
  geofence_id UUID REFERENCES school_geofences(id) ON DELETE SET NULL,
  api_key_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'maintenance')),
  last_heartbeat_at TIMESTAMPTZ,
  app_version VARCHAR(40),
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_attendance_kiosks_code UNIQUE (school_id, device_code),
  CONSTRAINT uq_attendance_kiosks_school_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_attendance_kiosks_updated_at
  BEFORE UPDATE ON attendance_kiosks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_attendance_kiosks_status
  ON attendance_kiosks (school_id, status);

-- 4. Staff Punch Events (Immutable telemetry of every biometric & GPS punch attempt)
CREATE TABLE IF NOT EXISTS staff_punch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  work_date DATE NOT NULL,
  punch_type VARCHAR(20) NOT NULL
    CHECK (punch_type IN ('punch_in', 'punch_out', 'break_start', 'break_end')),
  punched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verification_status VARCHAR(40) NOT NULL
    CHECK (verification_status IN (
      'verified',
      'out_of_geofence',
      'poor_accuracy',
      'face_mismatch',
      'liveness_failed',
      'camera_denied',
      'location_denied',
      'technical_failure',
      'manual_review_required',
      'approved_exception'
    )),
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  accuracy_meters NUMERIC(7, 2),
  distance_meters NUMERIC(8, 2),
  geofence_id UUID REFERENCES school_geofences(id) ON DELETE SET NULL,
  geofence_verified BOOLEAN NOT NULL DEFAULT FALSE,
  liveness_score NUMERIC(5, 2),
  liveness_verified BOOLEAN NOT NULL DEFAULT FALSE,
  match_confidence NUMERIC(5, 2),
  face_matched BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason TEXT,
  device_source VARCHAR(30) NOT NULL DEFAULT 'employee_mobile'
    CHECK (device_source IN ('employee_mobile', 'kiosk', 'supervisor_portal', 'desktop_browser')),
  kiosk_id UUID REFERENCES attendance_kiosks(id) ON DELETE SET NULL,
  client_metadata JSONB DEFAULT '{}'::jsonb,
  linked_punch_in_id UUID REFERENCES staff_punch_events(id) ON DELETE SET NULL,
  attendance_record_id UUID REFERENCES staff_attendance(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_punch_events_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_staff_punch_events_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_staff_punch_events_staff_date
  ON staff_punch_events (school_id, staff_id, work_date, punched_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_punch_events_status
  ON staff_punch_events (school_id, verification_status, punched_at DESC);

-- 5. Staff Attendance Exceptions & Fallbacks (Manual Request & Approval Workflow)
CREATE TABLE IF NOT EXISTS staff_attendance_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL,
  work_date DATE NOT NULL,
  exception_type VARCHAR(40) NOT NULL
    CHECK (exception_type IN (
      'gps_failure',
      'camera_failure',
      'face_mismatch',
      'device_unavailable',
      'approved_offsite_duty',
      'missed_punch_in',
      'missed_punch_out',
      'other'
    )),
  requested_punch_in TIMESTAMPTZ,
  requested_punch_out TIMESTAMPTZ,
  reason TEXT NOT NULL,
  supporting_document_name VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_att_exceptions_school_id UNIQUE (school_id, id),
  CONSTRAINT fk_staff_att_exceptions_staff
    FOREIGN KEY (school_id, staff_id) REFERENCES staff(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_staff_att_exceptions_review CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE TRIGGER trg_staff_att_exceptions_updated_at
  BEFORE UPDATE ON staff_attendance_exceptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_staff_att_exceptions_queue
  ON staff_attendance_exceptions (school_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_att_exceptions_staff
  ON staff_attendance_exceptions (school_id, staff_id, work_date DESC);

-- 6. Row-Level Security Policies for Tenant Isolation
ALTER TABLE school_geofences ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_school_geofences ON school_geofences
  FOR ALL USING (school_id = NULLIF(current_setting('app.school_id', true), '')::uuid);

ALTER TABLE staff_biometric_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_staff_biometric_profiles ON staff_biometric_profiles
  FOR ALL USING (school_id = NULLIF(current_setting('app.school_id', true), '')::uuid);

ALTER TABLE attendance_kiosks ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_attendance_kiosks ON attendance_kiosks
  FOR ALL USING (school_id = NULLIF(current_setting('app.school_id', true), '')::uuid);

ALTER TABLE staff_punch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_staff_punch_events ON staff_punch_events
  FOR ALL USING (school_id = NULLIF(current_setting('app.school_id', true), '')::uuid);

ALTER TABLE staff_attendance_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_staff_attendance_exceptions ON staff_attendance_exceptions
  FOR ALL USING (school_id = NULLIF(current_setting('app.school_id', true), '')::uuid);
