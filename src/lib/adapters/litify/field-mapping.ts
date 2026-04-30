const CASE_TYPE_TO_LITIFY: Record<string, string> = {
  workers_comp: "Workers' Compensation",
  auto_accident: "Auto Accident",
  slip_and_fall: "Premises Liability",
  premises_liability: "Premises Liability",
  medical_malpractice: "Medical Malpractice",
  product_liability: "Product Liability",
  wrongful_death: "Wrongful Death",
  general_injury: "General Personal Injury",
};

const STATUS_MAP: Record<string, string> = {
  qualified: "Qualified",
  needs_review: "Needs Review",
  rejected: "Rejected",
};

const LANGUAGE_MAP: Record<string, string> = {
  en: "English",
  es: "Spanish",
  hi: "Hindi",
};

export function mapCaseType(callsofiaCaseType: string): string {
  return CASE_TYPE_TO_LITIFY[callsofiaCaseType] ?? "General Personal Injury";
}

export function mapStatus(callsofiaStatus: string): string {
  return STATUS_MAP[callsofiaStatus] ?? "New";
}

export function mapLanguage(code: string): string {
  return LANGUAGE_MAP[code] ?? "English";
}

export interface IntakeFields {
  CallSofia_Incident_Date__c?: string;
  CallSofia_Injury_Type__c?: string;
  CallSofia_Employer_Name__c?: string;
  CallSofia_Medical_Treatment__c?: string;
  CallSofia_Prior_Attorney__c?: boolean;
  CallSofia_Summary__c?: string;
  CallSofia_Quality_Score__c?: number;
}

export function mapExtractedVars(extracted: Record<string, unknown>): IntakeFields {
  const out: IntakeFields = {};
  if (typeof extracted.incident_date === "string") out.CallSofia_Incident_Date__c = extracted.incident_date;
  if (typeof extracted.injury_type === "string") out.CallSofia_Injury_Type__c = extracted.injury_type;
  if (typeof extracted.employer_name === "string") out.CallSofia_Employer_Name__c = extracted.employer_name;
  if (typeof extracted.medical_treatment === "string") out.CallSofia_Medical_Treatment__c = extracted.medical_treatment;
  if (typeof extracted.represented_by_attorney === "boolean") out.CallSofia_Prior_Attorney__c = extracted.represented_by_attorney;
  return out;
}
