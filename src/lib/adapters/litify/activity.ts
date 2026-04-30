import { litifyAuth } from "./auth";
import { logger } from "@/lib/logger";

export interface InboundCallStartInput {
  personId: string;
  callId: string;
  twilioSid: string;
}

export interface CompleteCallInput {
  callId: string;
  duration: number;
  intakeId: string;
}

// Use jsforce's `sobject().findOne(conditions, fields)` for parameterized queries.
// jsforce serializes the condition object into SOQL with proper escaping.

export async function startInboundCall(input: InboundCallStartInput): Promise<{ id: string }> {
  const conn = await litifyAuth.getConnection();
  const result = await conn.sobject("Task").create({
    Subject: "Inbound Call (CallSofia)",
    Status: "In Progress",
    Type: "Call",
    WhoId: input.personId,
    CallType: "Inbound",
    CallSofia_Call_ID__c: input.callId,
    CallSofia_Twilio_SID__c: input.twilioSid,
  });
  if (!result.success) {
    throw new Error(`Task create failed: ${JSON.stringify((result as never as { errors: unknown }).errors)}`);
  }
  logger.info("litify_task_created", { id: result.id, call_id: input.callId });
  return { id: result.id! };
}

export async function completeCall(input: CompleteCallInput): Promise<void> {
  const conn = await litifyAuth.getConnection();
  const task = await conn
    .sobject("Task")
    .findOne<{ Id: string }>({ CallSofia_Call_ID__c: input.callId }, ["Id"]);
  const taskId = task?.Id;
  if (!taskId) {
    logger.warn("litify_task_not_found_for_complete", { call_id: input.callId });
    return;
  }
  await conn.sobject("Task").update({
    Id: taskId,
    Status: "Completed",
    CallDurationInSeconds: Math.round(input.duration),
    WhatId: input.intakeId,
  });
  logger.info("litify_task_completed", { id: taskId, call_id: input.callId });
}

export async function appendNote(callId: string, note: string): Promise<void> {
  const conn = await litifyAuth.getConnection();
  const task = await conn
    .sobject("Task")
    .findOne<{ Id: string; Description?: string }>(
      { CallSofia_Call_ID__c: callId },
      ["Id", "Description"],
    );
  if (!task) return;
  const merged = (task.Description ?? "") + "\n" + note;
  await conn.sobject("Task").update({ Id: task.Id, Description: merged });
}
