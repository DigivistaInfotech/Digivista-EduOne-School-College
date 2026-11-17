import { api } from "./api";
export interface InstitutionMaster {
  id: string;
  kind: string;
  code: string;
  label: string;
  institutionType: "all" | "school" | "college" | "university";
  active: boolean;
  notes: string;
}
export const getInstitutionMasters = (school: string) =>
  api<{ items: InstitutionMaster[] }>(
    `/api/schools/${school}/institution-masters`,
  );
export const MASTER_KINDS = [
  "staff_type",
  "designation",
  "department",
  "employment_type",
  "cost_centre",
  "activity_type",
  "vehicle_model",
  "vehicle_type",
  "fuel_type",
  "maintenance_type",
];
