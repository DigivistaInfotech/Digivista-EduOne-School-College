export const INDIA_STATES = [
  {
    code: "AP",
    name: "Andhra Pradesh",
    nameHi: "आंध्र प्रदेश",
    defaultLanguage: "en",
  },
  {
    code: "AR",
    name: "Arunachal Pradesh",
    nameHi: "अरुणाचल प्रदेश",
    defaultLanguage: "en",
  },
  { code: "AS", name: "Assam", nameHi: "असम", defaultLanguage: "en" },
  { code: "BR", name: "Bihar", nameHi: "बिहार", defaultLanguage: "hi" },
  {
    code: "CG",
    name: "Chhattisgarh",
    nameHi: "छत्तीसगढ़",
    defaultLanguage: "hi",
  },
  { code: "GA", name: "Goa", nameHi: "गोवा", defaultLanguage: "en" },
  { code: "GJ", name: "Gujarat", nameHi: "गुजरात", defaultLanguage: "en" },
  { code: "HR", name: "Haryana", nameHi: "हरियाणा", defaultLanguage: "hi" },
  {
    code: "HP",
    name: "Himachal Pradesh",
    nameHi: "हिमाचल प्रदेश",
    defaultLanguage: "hi",
  },
  { code: "JH", name: "Jharkhand", nameHi: "झारखंड", defaultLanguage: "hi" },
  { code: "KA", name: "Karnataka", nameHi: "कर्नाटक", defaultLanguage: "en" },
  { code: "KL", name: "Kerala", nameHi: "केरल", defaultLanguage: "en" },
  {
    code: "MH",
    name: "Maharashtra",
    nameHi: "महाराष्ट्र",
    defaultLanguage: "en",
  },
  { code: "MN", name: "Manipur", nameHi: "मणिपुर", defaultLanguage: "en" },
  { code: "ML", name: "Meghalaya", nameHi: "मेघालय", defaultLanguage: "en" },
  { code: "MZ", name: "Mizoram", nameHi: "मिज़ोरम", defaultLanguage: "en" },
  { code: "NL", name: "Nagaland", nameHi: "नागालैंड", defaultLanguage: "en" },
  { code: "OD", name: "Odisha", nameHi: "ओडिशा", defaultLanguage: "en" },
  { code: "PB", name: "Punjab", nameHi: "पंजाब", defaultLanguage: "en" },
  { code: "RJ", name: "Rajasthan", nameHi: "राजस्थान", defaultLanguage: "hi" },
  { code: "SK", name: "Sikkim", nameHi: "सिक्किम", defaultLanguage: "en" },
  { code: "TN", name: "Tamil Nadu", nameHi: "तमिलनाडु", defaultLanguage: "en" },
  { code: "TG", name: "Telangana", nameHi: "तेलंगाना", defaultLanguage: "en" },
  { code: "TR", name: "Tripura", nameHi: "त्रिपुरा", defaultLanguage: "en" },
  {
    code: "UP",
    name: "Uttar Pradesh",
    nameHi: "उत्तर प्रदेश",
    defaultLanguage: "hi",
  },
  {
    code: "MP",
    name: "Madhya Pradesh",
    nameHi: "मध्य प्रदेश",
    defaultLanguage: "hi",
  },
  {
    code: "UK",
    name: "Uttarakhand",
    nameHi: "उत्तराखंड",
    defaultLanguage: "hi",
  },
  {
    code: "WB",
    name: "West Bengal",
    nameHi: "पश्चिम बंगाल",
    defaultLanguage: "en",
  },
  {
    code: "AN",
    name: "Andaman and Nicobar Islands",
    nameHi: "अंडमान और निकोबार द्वीपसमूह",
    defaultLanguage: "en",
  },
  { code: "CH", name: "Chandigarh", nameHi: "चंडीगढ़", defaultLanguage: "hi" },
  {
    code: "DH",
    name: "Dadra and Nagar Haveli and Daman and Diu",
    nameHi: "दादरा और नगर हवेली और दमन और दीव",
    defaultLanguage: "en",
  },
  { code: "DL", name: "Delhi", nameHi: "दिल्ली", defaultLanguage: "hi" },
  {
    code: "JK",
    name: "Jammu and Kashmir",
    nameHi: "जम्मू और कश्मीर",
    defaultLanguage: "en",
  },
  { code: "LA", name: "Ladakh", nameHi: "लद्दाख", defaultLanguage: "en" },
  {
    code: "LD",
    name: "Lakshadweep",
    nameHi: "लक्षद्वीप",
    defaultLanguage: "en",
  },
  { code: "PY", name: "Puducherry", nameHi: "पुदुचेरी", defaultLanguage: "en" },
] as const;

export type AppLanguage = 'en' | 'hi';
export interface RegionalSettings {
  countryCode: 'IN';
  stateCode: string | null;
  defaultLanguage: AppLanguage;
}

export const DEFAULT_REGIONAL_SETTINGS: RegionalSettings = {
  countryCode: "IN",
  stateCode: null,
  defaultLanguage: "en",
};

export interface RegionalSettingsResponse {
  settings: RegionalSettings;
  version: number;
}
