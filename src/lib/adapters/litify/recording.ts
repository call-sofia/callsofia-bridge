import { litifyAuth } from "./auth";
import { logger } from "@/lib/logger";
import { config } from "@/lib/config";

export interface AttachRecordingInput {
  intakeId: string;
  downloadUrl: string;
  callId: string;
}

export interface AttachRecordingResult {
  // Present only in `attach` mode (we created a ContentVersion).
  contentVersionId: string | null;
  contentDocumentId: string | null;
  // Present in both modes — the field that ended up storing the URL on the Intake.
  intakeId: string;
  mode: "url" | "attach";
}

/**
 * Attach a call recording to a Litify Intake.
 *
 * Modes (controlled by `LITIFY_RECORDING_MODE`):
 * - `url` (default): write the presigned download URL into
 *   `CallSofia_Recording_URL__c` on the Intake. Cheap, no binary transfer,
 *   but the URL expires (typically 7 days for S3 presigned).
 * - `attach`: download the OGG and upload as a Salesforce ContentVersion.
 *   Self-contained but base64-loads the file in memory — risks OOM on
 *   Vercel Functions (~50 MB limit). Use only when files are small and
 *   long-term retention in Salesforce is required.
 *
 * Default flipped from `attach` to `url` after a 30 MB OGG → ~40 MB base64
 * caused OOM crashes on Vercel.
 */
export async function attachRecordingToIntake(
  input: AttachRecordingInput,
): Promise<AttachRecordingResult> {
  const mode = config().litify.recordingMode;

  // Download the OGG OUTSIDE the Salesforce connection scope so we don't
  // hold a session open while waiting on S3. In url mode this is skipped.
  let buf: Buffer | null = null;
  if (mode === "attach") {
    const res = await fetch(input.downloadUrl);
    if (!res.ok) throw new Error(`Recording download failed: ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }

  return litifyAuth.withFreshConnection(async (conn) => {
    if (mode === "url") {
      await conn.sobject("litify_pm__Intake__c").update({
        Id: input.intakeId,
        CallSofia_Recording_URL__c: input.downloadUrl,
      });
      logger.info("litify_recording_url_stored", {
        intake_id: input.intakeId,
        call_id: input.callId,
      });
      return {
        contentVersionId: null,
        contentDocumentId: null,
        intakeId: input.intakeId,
        mode: "url" as const,
      };
    }

    // attach mode — legacy path, base64-loads the OGG.
    const cv = await conn.sobject("ContentVersion").create({
      Title: `CallSofia Recording — ${input.callId}`,
      PathOnClient: `${input.callId}.ogg`,
      VersionData: buf!.toString("base64"),
      FirstPublishLocationId: input.intakeId,
      Description: `Inbound call recording, CallSofia call_id=${input.callId}`,
    });

    if (!cv.success) {
      throw new Error(`ContentVersion create failed: ${JSON.stringify((cv as never as { errors: unknown }).errors)}`);
    }
    logger.info("litify_recording_attached", { intake_id: input.intakeId, cv_id: cv.id });
    return {
      contentVersionId: cv.id!,
      contentDocumentId: null,
      intakeId: input.intakeId,
      mode: "attach" as const,
    };
  });
}
