import { litifyAuth } from "./auth";
import { getLitifyCaseTypeId } from "./case-type-cache";
import { logger } from "@/lib/logger";
import { config } from "@/lib/config";

export interface IntakeCreateInput {
  personId: string;
  callId: string;
  callerPhone: string;
  startedAt: string;
  endedAt: string;
  duration: number;
  language: string;
  caseType: string;
  twilioSid: string;
  summary?: string;
}

export interface LitifyIntake {
  Id: string;
  Name?: string;
  CallSofia_Call_ID__c?: string;
  litify_pm__Status__c?: string;
}

// Use jsforce's `sobject().findOne(conditions, fields)` for parameterized queries.
// jsforce serializes the condition object into SOQL with proper escaping.
export async function findByCallId(callId: string): Promise<LitifyIntake | null> {
  const conn = await litifyAuth.getConnection();
  const record = await conn
    .sobject("litify_pm__Intake__c")
    .findOne<LitifyIntake>(
      { CallSofia_Call_ID__c: callId },
      ["Id", "Name", "CallSofia_Call_ID__c", "litify_pm__Status__c"],
    );
  return (record as LitifyIntake | null) ?? null;
}

export async function createIntake(input: IntakeCreateInput): Promise<{ id: string }> {
  const conn = await litifyAuth.getConnection();
  const caseTypeId = await getLitifyCaseTypeId(input.caseType);
  const cfg = config().litify;
  const result = await conn.sobject("litify_pm__Intake__c").create({
    litify_pm__Person__c: input.personId,
    litify_pm__Source__c: "AI Voice Intake (CallSofia)",
    litify_pm__Status__c: "New",
    litify_pm__Date_Opened__c: input.startedAt,
    litify_pm__Case_Type_Lookup__c: caseTypeId ?? undefined,
    OwnerId: cfg.intakeDefaultOwnerId,
    RecordTypeId: cfg.intakeRecordTypeId,
    CallSofia_Call_ID__c: input.callId,
    CallSofia_Twilio_SID__c: input.twilioSid,
    CallSofia_Language__c: input.language,
    CallSofia_Case_Type__c: input.caseType,
    CallSofia_Summary__c: input.summary,
    CallSofia_Last_Synced_At__c: new Date().toISOString(),
  });
  if (!result.success) throw new Error(`Intake create failed: ${JSON.stringify((result as any).errors)}`);
  logger.info("litify_intake_created", { id: result.id, call_id: input.callId });
  return { id: result.id! };
}

export async function upsertByCallId(callId: string, fields: Record<string, unknown>): Promise<{ id: string }> {
  const existing = await findByCallId(callId);
  if (existing) {
    const conn = await litifyAuth.getConnection();
    await conn.sobject("litify_pm__Intake__c").update({
      Id: existing.Id,
      ...fields,
      CallSofia_Last_Synced_At__c: new Date().toISOString(),
    });
    return { id: existing.Id };
  }
  // No existing intake — caller should ensure it's created via createIntake first
  throw new Error(`No intake found for call_id=${callId}; call createIntake first`);
}

export async function attachRecording(intakeId: string, opts: { downloadUrl: string; fileSize: number }): Promise<string> {
  const conn = await litifyAuth.getConnection();
  await conn.sobject("litify_pm__Intake__c").update({
    Id: intakeId,
    CallSofia_Recording_URL__c: opts.downloadUrl,
  });
  return intakeId;
}

export async function triggerConversionFlow(intakeId: string): Promise<void> {
  // Salesforce Flow invocation — typically via REST /services/data/vXX.X/actions/custom/flow/<FlowName>
  logger.info("litify_intake_conversion_triggered", { id: intakeId });
}
