CREATE TABLE transport_vehicle_profiles (
 school_id UUID NOT NULL REFERENCES schools(id), vehicle_id UUID NOT NULL,
 model_id UUID, vehicle_type_id UUID, fuel_type_id UUID, audit_details JSONB NOT NULL DEFAULT '{}',
 PRIMARY KEY(school_id,vehicle_id), FOREIGN KEY(school_id,vehicle_id) REFERENCES transport_vehicles(school_id,id),
 FOREIGN KEY(school_id,model_id) REFERENCES institution_masters(school_id,id),
 FOREIGN KEY(school_id,vehicle_type_id) REFERENCES institution_masters(school_id,id),
 FOREIGN KEY(school_id,fuel_type_id) REFERENCES institution_masters(school_id,id)
);
ALTER TABLE transport_maintenance ALTER COLUMN performed_on DROP NOT NULL;
ALTER TABLE transport_maintenance ADD COLUMN planned_on DATE, ADD COLUMN vendor_id UUID, ADD COLUMN expense_id UUID, ADD COLUMN audit_details JSONB NOT NULL DEFAULT '{}';
ALTER TABLE transport_maintenance ADD CONSTRAINT maintenance_vendor_fk FOREIGN KEY(school_id,vendor_id) REFERENCES vendors(school_id,id), ADD CONSTRAINT maintenance_expense_fk FOREIGN KEY(school_id,expense_id) REFERENCES procurement_expenses(school_id,id);
CREATE FUNCTION seed_transport_masters(p_school UUID) RETURNS void LANGUAGE SQL AS $seed$
 INSERT INTO institution_masters(school_id,kind,code,label,institution_type,notes) SELECT p_school,v.kind,v.code,v.label,'all',v.notes FROM (VALUES
 ('vehicle_type','school_bus','School bus','Verify usage and RC class'),('vehicle_type','mini_bus','Mini bus','Verify usage and RC class'),('vehicle_type','van','Van / traveller','Verify usage and RC class'),('vehicle_type','non_transport','Non-transport / staff vehicle','Not automatically approved for student transport'),
 ('fuel_type','diesel','Diesel',''),('fuel_type','petrol','Petrol',''),('fuel_type','cng','CNG',''),('fuel_type','electric','Electric',''),('fuel_type','lpg','LPG',''),('fuel_type','hybrid','Hybrid',''),
 ('vehicle_model','tata_starbus','Tata Starbus','https://busesandvans.tatamotors.com/brand/starbus'),
 ('vehicle_model','ashok_sunshine','Ashok Leyland Sunshine','https://www.ashokleyland.com/in/buses/brands/sunshine'),
 ('vehicle_model','force_traveller','Force Traveller N School Bus','https://www.forcemotors.com/vehicles/school-buses/'),
 ('vehicle_model','eicher_skyline','Eicher Skyline Pro Next','https://www.eichertrucksandbuses.com/buses/school-bus/skyline-pro'),
 ('maintenance_type','periodic_service','Periodic servicing',''),('maintenance_type','repair','Mechanical / electrical repair',''),('maintenance_type','tyres','Tyres / alignment',''),('maintenance_type','brakes','Brakes / safety inspection',''),('maintenance_type','bodywork','Body / accident repair',''),('maintenance_type','inspection','Fitness / permit / PUC inspection',''),('maintenance_type','battery','Battery / charging system',''),('maintenance_type','cleaning','Cleaning / sanitation','')
 )v(kind,code,label,notes) ON CONFLICT DO NOTHING;
$seed$;
SELECT seed_transport_masters(id) FROM schools;
ALTER TABLE transport_vehicle_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transport_vehicle_profiles USING(school_id=current_app_school_id()) WITH CHECK(school_id=current_app_school_id());
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN GRANT SELECT,INSERT,UPDATE ON transport_vehicle_profiles TO erp_app; END IF; END $$;
