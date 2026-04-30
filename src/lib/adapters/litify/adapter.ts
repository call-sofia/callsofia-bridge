import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { CallSofiaEvent } from "@/lib/webhook/types";
import type { AdapterContext, CrmAdapter, HandlerResult, HealthStatus } from "../types";
import * as Activity from "./activity";
import { litifyAuth } from "./auth";
import { mapCaseType, mapExtractedVars, mapStatus } from "./field-mapping";
import * as Intake from "./intake";
import * as Person from "./person";
import { attachRecordingToIntake } from "./recording";

export class LitifyAdapter implements CrmAdapter {
  readonly name = "litify";

  async init(): Promise<void> {
    await litifyAuth.getConnection();
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      const ok = await litifyAuth.ping();
      return { healthy: ok, message: ok ? "ok" : "ping failed", timestamp: new Date() };
    } catch (err) {
      return {
        healthy: false,
        message: (err as Error).message,
        timestamp: new Date(),
      };
    }
  }

  async handle(event: CallSofiaEvent, _ctx: AdapterContext): Promise<HandlerResult> {
    const p = event.data.payload as Record<string, unknown>;
    const callId = (p.call_id ?? p.room_name) as string | undefined;
    const phone = (p.caller_phone ?? p.from_phone) as string | undefined;

    try {
      switch (event.event_type) {
        case "call.ringing": {
          if (!phone || !callId) return { outcome: "noop", message: "missing phone or call_id" };
          const person = await Person.findByPhone(phone);
          if (!person) return { outcome: "noop", message: "no existing person" };
          const task = await Activity.startInboundCall({
            personId: person.Id,
            callId,
            twilioSid: (p.twilio_call_sid as string | undefined) ?? "",
          });
          return { outcome: "success", crm_record_id: task.id };
        }

        case "call.completed":
        case "call.ended": {
          if (!phone || !callId) return { outcome: "noop", message: "missing phone or call_id" };
          const person = await Person.upsertByPhone(phone, {});
          const intake = await Intake.createIntake({
            personId: person.Id,
            callId,
            callerPhone: phone,
            startedAt: (p.started_at as string) ?? "",
            endedAt: (p.ended_at as string) ?? "",
            duration: (p.duration as number) ?? 0,
            language: (p.language as string) ?? "",
            caseType: mapCaseType((p.case_type as string) ?? ""),
            twilioSid: (p.twilio_call_sid as string) ?? "",
            summary: p.summary as string | undefined,
          });
          await Activity.completeCall({
            callId,
            duration: (p.duration as number) ?? 0,
            intakeId: intake.id,
          });
          return { outcome: "success", crm_record_id: intake.id };
        }

        case "call.processed":
        case "call.extracted": {
          if (!callId) return { outcome: "noop", message: "missing call_id" };
          const fields = mapExtractedVars(
            (p.extracted_vars as Record<string, unknown>) ?? {},
          );
          const intake = await Intake.upsertByCallId(callId, {
            ...fields,
            CallSofia_Summary__c: p.summary,
          });
          return { outcome: "success", crm_record_id: intake.id };
        }

        case "lead.qualified": {
          if (!callId) return { outcome: "noop", message: "missing call_id" };
          const evaluation = p.evaluation as { score?: number } | undefined;
          const intake = await Intake.upsertByCallId(callId, {
            litify_pm__Status__c: mapStatus("qualified"),
            CallSofia_Quality_Score__c: evaluation?.score,
          });
          if (config().litify.autoConvertQualified) {
            await Intake.triggerConversionFlow(intake.id);
          }
          return { outcome: "success", crm_record_id: intake.id };
        }

        case "lead.needs_review": {
          if (!callId) return { outcome: "noop", message: "missing call_id" };
          const cfg = config().litify;
          const intake = await Intake.upsertByCallId(callId, {
            litify_pm__Status__c: mapStatus("needs_review"),
            OwnerId: cfg.intakeCoordinatorUserId,
            Description: `NEEDS REVIEW: ${p.review_reason ?? ""}\n\n${p.summary ?? ""}`,
          });
          return { outcome: "success", crm_record_id: intake.id };
        }

        case "evaluation.complete": {
          if (!callId) return { outcome: "noop", message: "missing call_id" };
          const evaluation = p.evaluation as { score?: number; summary?: string } | undefined;
          const intake = await Intake.upsertByCallId(callId, {
            CallSofia_Quality_Score__c: evaluation?.score,
          });
          if (evaluation?.summary) {
            await Activity.appendNote(callId, `Evaluation: ${evaluation.summary}`);
          }
          if (p.qualified === true && config().litify.autoConvertQualified) {
            await Intake.triggerConversionFlow(intake.id);
          }
          return { outcome: "success", crm_record_id: intake.id };
        }

        case "recording.ogg": {
          if (!callId) return { outcome: "noop", message: "missing call_id" };
          const intake = await Intake.findByCallId(callId);
          if (!intake) return { outcome: "noop", message: "no intake to attach to" };
          const r = await attachRecordingToIntake({
            intakeId: intake.Id,
            downloadUrl: (p.download_url as string) ?? "",
            callId,
          });
          return { outcome: "success", crm_record_id: r.contentVersionId };
        }

        case "call.transferred":
        case "call.transfer_failed": {
          if (!callId) return { outcome: "noop", message: "missing call_id" };
          await Activity.appendNote(callId, `${event.event_type}: ${JSON.stringify(p)}`);
          return { outcome: "success" };
        }

        default:
          return { outcome: "noop", message: `no handler for ${event.event_type}` };
      }
    } catch (err) {
      const e = err as Error & { errorCode?: string };
      logger.error("litify_handler_error", {
        event_type: event.event_type,
        err: e.message,
      });
      const retryable = !["INVALID_FIELD", "DUPLICATE_VALUE"].includes(e.errorCode ?? "");
      return {
        outcome: retryable ? "retry" : "failure",
        error: { code: e.errorCode ?? "unknown", message: e.message, retryable },
      };
    }
  }
}
