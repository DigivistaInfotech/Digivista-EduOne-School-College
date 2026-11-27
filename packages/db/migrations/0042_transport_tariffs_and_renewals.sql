ALTER TABLE student_transport_allocations ADD COLUMN valid_until DATE, ADD COLUMN reminder_days INTEGER NOT NULL DEFAULT 60 CHECK(reminder_days BETWEEN 1 AND 180);
ALTER TABLE student_transport_allocations ADD CONSTRAINT transport_validity_dates CHECK(valid_until IS NULL OR valid_until>=effective_from);
CREATE TABLE transport_tariffs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),school_id UUID NOT NULL REFERENCES schools(id),route_id UUID NOT NULL,fee_head_id UUID NOT NULL,
 period VARCHAR(20) NOT NULL CHECK(period IN('monthly','term','annual','one_time')),amount NUMERIC(12,2) NOT NULL CHECK(amount>=0),
 effective_from DATE NOT NULL,effective_to DATE,active BOOLEAN NOT NULL DEFAULT true,authority_reference VARCHAR(200),
 created_by UUID NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),FOREIGN KEY(school_id,route_id) REFERENCES transport_routes(school_id,id),FOREIGN KEY(school_id,fee_head_id) REFERENCES fee_heads(school_id,id),
 CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE TABLE transport_renewal_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),school_id UUID NOT NULL REFERENCES schools(id),allocation_id UUID NOT NULL,
 requested_until DATE NOT NULL,requested_by UUID NOT NULL REFERENCES users(id),reason VARCHAR(500),status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
 reviewed_by UUID REFERENCES users(id),reviewed_at TIMESTAMPTZ,review_note VARCHAR(500),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),FOREIGN KEY(school_id,allocation_id) REFERENCES student_transport_allocations(school_id,id)
);
CREATE UNIQUE INDEX transport_one_pending_renewal ON transport_renewal_requests(school_id,allocation_id) WHERE status='pending';
DO $policies$ DECLARE t TEXT; BEGIN FOREACH t IN ARRAY ARRAY['transport_tariffs','transport_renewal_requests'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(school_id=current_app_school_id()) WITH CHECK(school_id=current_app_school_id())',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO erp_app',t); END IF; END LOOP; END $policies$;
INSERT INTO fee_heads(school_id,code,name,description) SELECT id,'TRANSPORT','Transport fee','Route tariff mapping; charges remain in the central fee ledger' FROM schools ON CONFLICT(school_id,code) DO NOTHING;
