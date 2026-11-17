ALTER TABLE vendors
  ADD COLUMN category VARCHAR(40),
  ADD COLUMN service_type VARCHAR(30),
  ADD COLUMN secondary_phone VARCHAR(40),
  ADD COLUMN gstin VARCHAR(15),
  ADD COLUMN contract_starts_on DATE,
  ADD COLUMN contract_ends_on DATE,
  ADD CONSTRAINT chk_vendor_contract_dates CHECK(contract_starts_on IS NULL OR contract_ends_on IS NULL OR contract_ends_on>=contract_starts_on);
ALTER TABLE procurement_budgets
  ADD COLUMN expense_head_code VARCHAR(80),
  ADD COLUMN floor VARCHAR(80),
  ADD COLUMN vendor_id UUID,
  ADD CONSTRAINT fk_budget_vendor_same_school FOREIGN KEY(school_id,vendor_id) REFERENCES vendors(school_id,id);
CREATE UNIQUE INDEX uq_budget_head_cost_centre ON procurement_budgets(school_id,academic_year_id,expense_head_code,coalesce(department,''),coalesce(floor,''),coalesce(vendor_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE expense_head_code IS NOT NULL;
ALTER TABLE purchase_requests ADD COLUMN budget_id UUID,
  ADD CONSTRAINT fk_purchase_request_budget_same_school FOREIGN KEY(school_id,budget_id) REFERENCES procurement_budgets(school_id,id);
ALTER TABLE purchase_order_items
  ADD COLUMN expense_head_code VARCHAR(80),
  ADD COLUMN hsn_sac VARCHAR(8),
  ADD COLUMN gst_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(gst_percent BETWEEN 0 AND 100),
  ADD COLUMN gst_amount NUMERIC(16,2) GENERATED ALWAYS AS(round(quantity*unit_price*gst_percent/100,2)) STORED;
