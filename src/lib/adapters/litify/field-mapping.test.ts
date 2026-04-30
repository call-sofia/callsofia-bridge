import { describe, it, expect } from "vitest";
import { mapCaseType, mapStatus, mapExtractedVars, mapLanguage } from "./field-mapping";

describe("mapCaseType", () => {
  it("maps known case types", () => {
    expect(mapCaseType("workers_comp")).toBe("Workers' Compensation");
    expect(mapCaseType("auto_accident")).toBe("Auto Accident");
  });
  it("falls back to General for unknown", () => {
    expect(mapCaseType("totally_made_up")).toBe("General Personal Injury");
  });
});

describe("mapStatus", () => {
  it("qualified → Qualified", () => {
    expect(mapStatus("qualified")).toBe("Qualified");
  });
  it("needs_review → Needs Review", () => {
    expect(mapStatus("needs_review")).toBe("Needs Review");
  });
});

describe("mapExtractedVars", () => {
  it("maps incident_date and injury_type", () => {
    const result = mapExtractedVars({
      incident_date: "2026-04-24",
      injury_type: "lower_back",
      employer_name: "Acme Co",
      represented_by_attorney: false,
    });
    expect(result.CallSofia_Incident_Date__c).toBe("2026-04-24");
    expect(result.CallSofia_Injury_Type__c).toBe("lower_back");
    expect(result.CallSofia_Employer_Name__c).toBe("Acme Co");
    expect(result.CallSofia_Prior_Attorney__c).toBe(false);
  });
  it("strips undefined values", () => {
    const result = mapExtractedVars({ incident_date: "2026-01-01" });
    expect(result.CallSofia_Injury_Type__c).toBeUndefined();
  });
});

describe("mapLanguage", () => {
  it("maps language codes", () => {
    expect(mapLanguage("en")).toBe("English");
    expect(mapLanguage("es")).toBe("Spanish");
    expect(mapLanguage("hi")).toBe("Hindi");
  });
});
