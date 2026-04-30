import { litifyAuth } from "./auth";
import { logger } from "@/lib/logger";

export interface AttachRecordingInput {
  intakeId: string;
  downloadUrl: string;
  callId: string;
}

export async function attachRecordingToIntake(
  input: AttachRecordingInput,
): Promise<{ contentVersionId: string; contentDocumentId: string | null }> {
  const conn = await litifyAuth.getConnection();
  const res = await fetch(input.downloadUrl);
  if (!res.ok) throw new Error(`Recording download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const cv = await conn.sobject("ContentVersion").create({
    Title: `CallSofia Recording — ${input.callId}`,
    PathOnClient: `${input.callId}.ogg`,
    VersionData: buf.toString("base64"),
    FirstPublishLocationId: input.intakeId,
    Description: `Inbound call recording, CallSofia call_id=${input.callId}`,
  });

  if (!cv.success) {
    throw new Error(`ContentVersion create failed: ${JSON.stringify((cv as never as { errors: unknown }).errors)}`);
  }
  logger.info("litify_recording_attached", { intake_id: input.intakeId, cv_id: cv.id });
  return { contentVersionId: cv.id!, contentDocumentId: null };
}
