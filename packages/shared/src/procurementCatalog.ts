/** School expense labels are a convenience catalogue, not government account codes. */
export const SCHOOL_EXPENSE_GROUPS = [
  { code: 'stationery', name: 'Stationery & Printing', department: 'Administration', items: [
    ['stationery_office', 'Office stationery'], ['stationery_classroom', 'Classroom stationery'], ['printing_photocopy', 'Printing & photocopying'], ['exam_paper_printing', 'Question papers & answer sheets'], ['student_diaries', 'Student diaries & ID cards'], ['printer_consumables', 'Printer ink, toner & paper'],
  ] },
  { code: 'it_communication', name: 'IT & Communication', department: 'IT & Communication', items: [
    ['internet_broadband', 'Internet / broadband connection'], ['internet_leased_line', 'Internet leased line'], ['wifi_network', 'Wi-Fi & network maintenance'], ['telephone_landline', 'Telephone / landline expenses'], ['mobile_recharge', 'Mobile plans & recharge'], ['video_conferencing', 'Video conferencing services'], ['school_erp', 'School ERP & software subscriptions'], ['website_hosting', 'Website, domain & hosting'], ['computer_equipment', 'Computers, printers & accessories'], ['computer_maintenance', 'Computer maintenance / AMC'],
  ] },
  { code: 'security', name: 'Security & Surveillance', department: 'Security', items: [
    ['cctv_equipment', 'CCTV cameras & installation'], ['cctv_maintenance', 'CCTV / surveillance maintenance'], ['video_storage', 'Video recording & storage'], ['security_guards', 'Security guard services'], ['access_control', 'Access control & biometric equipment'], ['fire_safety', 'Fire safety equipment & servicing'],
  ] },
  { code: 'utilities', name: 'Utilities', department: 'Facilities & Maintenance', items: [
    ['electricity', 'Electricity charges'], ['water', 'Water supply & charges'], ['drinking_water', 'Drinking water / purifier servicing'], ['generator_fuel', 'Generator fuel & servicing'], ['ups_batteries', 'UPS, inverter & batteries'], ['solar_maintenance', 'Solar system maintenance'], ['cooking_gas', 'Cooking gas / fuel'],
  ] },
  { code: 'maintenance', name: 'Building & Maintenance', department: 'Facilities & Maintenance', items: [
    ['building_repairs', 'Building repairs & civil work'], ['electrical_repairs', 'Electrical repairs'], ['plumbing', 'Plumbing & sanitation repairs'], ['painting', 'Painting & waterproofing'], ['furniture_repairs', 'Furniture purchase & repairs'], ['air_conditioning', 'Air conditioning & ventilation servicing'], ['lift_maintenance', 'Lift maintenance / AMC'], ['grounds_gardening', 'Gardening & grounds maintenance'],
  ] },
  { code: 'housekeeping', name: 'Housekeeping & Sanitation', department: 'Housekeeping', items: [
    ['housekeeping_contract', 'Housekeeping / sweeper contract'], ['cleaning_materials', 'Cleaning materials & equipment'], ['waste_collection', 'Waste collection & disposal'], ['pest_control', 'Pest control services'], ['washroom_supplies', 'Washroom & hygiene supplies'],
  ] },
  { code: 'transport', name: 'Transport', department: 'Transport', items: [
    ['bus_fuel', 'School bus fuel'], ['vehicle_repairs', 'Vehicle servicing & repairs'], ['vehicle_insurance', 'Vehicle insurance'], ['vehicle_permits', 'Vehicle permits, fitness & taxes'], ['transport_contract', 'Hired bus / transport contract'], ['vehicle_tracking', 'GPS tracking services'], ['transport_tolls', 'Transport tolls & parking'],
  ] },
  { code: 'academics', name: 'Academics, Library & Laboratories', department: 'Academics', items: [
    ['teaching_materials', 'Teaching & learning materials'], ['textbooks', 'Textbooks & workbooks'], ['library_books', 'Library books & subscriptions'], ['science_lab', 'Science laboratory equipment & consumables'], ['computer_lab', 'Computer laboratory resources'], ['smart_classroom', 'Smart classroom / projector equipment'], ['exam_administration', 'Examination administration'], ['academic_events', 'Academic competitions & GK activities'],
  ] },
  { code: 'sports_arts', name: 'Sports, Arts & Activities', department: 'Sports & Activities', items: [
    ['sports_equipment', 'Sports equipment & kits'], ['sports_coaching', 'Sports coaching services'], ['music_arts', 'Music & arts materials'], ['cultural_events', 'Cultural events & annual function'], ['educational_visits', 'Educational visits & excursions'], ['activity_awards', 'Activity awards & certificates'],
  ] },
  { code: 'student_welfare', name: 'Student Welfare & Health', department: 'Student Welfare', items: [
    ['first_aid', 'First-aid & medical supplies'], ['health_checks', 'Student health checks'], ['counselling', 'Student counselling services'], ['student_meals', 'Student meals & nutrition'], ['uniform_support', 'Uniform / student support materials'], ['accessibility', 'Accessibility & inclusive learning support'],
  ] },
  { code: 'staff', name: 'Staff & Professional Development', department: 'Human Resources', items: [
    ['teaching_staff', 'Teaching staff costs'], ['non_teaching_staff', 'Non-teaching staff costs'], ['guest_teachers', 'Guest / substitute teacher services'], ['staff_training', 'Staff training & development'], ['staff_welfare', 'Staff welfare'],
  ] },
  { code: 'administration', name: 'Administration & Other School Expenses', department: 'Administration', items: [
    ['school_rent', 'School building rent'], ['insurance', 'School insurance'], ['audit_accounting', 'Audit & accounting services'], ['legal_professional', 'Legal & professional services'], ['postage_courier', 'Postage & courier'], ['bank_charges', 'Bank / payment processing charges'], ['affiliation_renewal', 'Affiliation & licence renewals'], ['contingency', 'School contingency reserve'],
  ] },
] as const;

export const SCHOOL_EXPENSE_ITEMS = SCHOOL_EXPENSE_GROUPS.flatMap((group) => group.items.map(([code, name]) => ({ code, name, groupCode: group.code, groupName: group.name, department: group.department })));
export const SCHOOL_DEPARTMENTS = ['Administration', 'Academics', 'Primary Wing', 'Secondary Wing', 'Senior Secondary Wing', 'IT & Communication', 'Library', 'Science Laboratory', 'Computer Laboratory', 'Security', 'Facilities & Maintenance', 'Housekeeping', 'Transport', 'Sports & Activities', 'Student Welfare', 'Human Resources', 'Hostel', 'Canteen'] as const;
export const SCHOOL_BUDGET_LOCATIONS = ['Whole campus', 'Basement', 'Ground floor', 'First floor', 'Second floor', 'Third floor', 'Fourth floor', 'Fifth floor', 'Sixth floor', 'Seventh floor', 'Eighth floor', 'Ninth floor', 'Tenth floor', 'Sports ground', 'Transport yard', 'Hostel', 'Off-campus facility'] as const;
export const VENDOR_CATEGORIES = [
  ['stationery', 'Stationery & printing'], ['books', 'Books & educational supplies'], ['it', 'IT equipment & software'], ['telecom', 'Internet & telephone'], ['security', 'Security & CCTV'], ['housekeeping', 'Housekeeping / sweeper services'], ['maintenance', 'Building & maintenance contractor'], ['electrical', 'Electrical / plumbing services'], ['transport', 'Transport & vehicle services'], ['laboratory', 'Laboratory supplies'], ['sports', 'Sports, arts & activity supplies'], ['catering', 'Catering & food supplies'], ['medical', 'Medical & wellbeing services'], ['professional', 'Professional / consultancy services'], ['general', 'General school supplies / services'],
] as const;
export const VENDOR_SERVICE_TYPES = [['goods','Goods supplier'],['services','Service provider'],['goods_services','Goods & services'],['contractor','Contractor / outsourced services'],['amc','Annual maintenance contract (AMC)']] as const;
