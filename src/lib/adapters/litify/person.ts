import { litifyAuth } from "./auth";
import { logger } from "@/lib/logger";

export interface LitifyPerson {
  Id: string;
  Name: string;
  Phone?: string;
}

export interface PersonInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

// TODO(litify-prod): `Phone` is a STANDARD Salesforce field that does not exist
// on Litify custom objects (`__c` suffix) by default. Litify uses
// `litify_pm__Phone__c`. The pre-existing code (and the ported tests, which mock
// `findOne` and never hit a real SOQL serializer) preserve the `Phone` field
// name; in a real Litify org this will silently return 0 rows from `findByPhone`
// (causing duplicate person creation on every call) or throw `INVALID_FIELD`.
// Verify the actual field on the customer's Litify package and switch this AND
// the `create()` payload below before any prod customer onboarding.
//
// Use jsforce's `sobject().findOne(conditions, fields)` for parameterized queries.
// jsforce serializes the conditions object into SOQL with proper escaping —
// no manual quote-escaping (which only handled `'` and missed `\`, newlines).
//
// Each data-path call goes through `withFreshConnection()` so a stale
// session token (Salesforce session policy < soft-TTL) auto-refreshes once
// on `INVALID_SESSION_ID` / `401` instead of dead-letterng the event after
// 10 retries against the same dead connection. See auth.ts:withFreshConnection.
export async function findByPhone(phone: string): Promise<LitifyPerson | null> {
  return litifyAuth.withFreshConnection(async (conn) => {
    const record = await conn
      .sobject("litify_pm__Person__c")
      .findOne<LitifyPerson>({ Phone: phone }, ["Id", "Name", "Phone"]);
    return (record as LitifyPerson | null) ?? null;
  });
}

export async function upsertByPhone(phone: string, input: PersonInput): Promise<LitifyPerson> {
  const existing = await findByPhone(phone);
  if (existing) {
    logger.debug("litify_person_found", { id: existing.Id });
    return existing;
  }
  const lastName = input.lastName ?? input.firstName ?? "Unknown";
  return litifyAuth.withFreshConnection(async (conn) => {
    const created = await conn.sobject("litify_pm__Person__c").create({
      litify_pm__First_Name__c: input.firstName,
      litify_pm__Last_Name__c: lastName,
      litify_pm__Email__c: input.email,
      Phone: phone,
    });
    if (!created.success) {
      throw new Error(`Person create failed: ${JSON.stringify((created as never as { errors: unknown }).errors)}`);
    }
    logger.info("litify_person_created", { id: created.id });
    return { Id: created.id!, Name: lastName, Phone: phone };
  });
}
