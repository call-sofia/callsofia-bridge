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

// Use jsforce's `sobject().findOne(conditions, fields)` for parameterized queries.
// jsforce serializes the conditions object into SOQL with proper escaping —
// no manual quote-escaping (which only handled `'` and missed `\`, newlines).
export async function findByPhone(phone: string): Promise<LitifyPerson | null> {
  const conn = await litifyAuth.getConnection();
  const record = await conn
    .sobject("litify_pm__Person__c")
    .findOne<LitifyPerson>({ Phone: phone }, ["Id", "Name", "Phone"]);
  return (record as LitifyPerson | null) ?? null;
}

export async function upsertByPhone(phone: string, input: PersonInput): Promise<LitifyPerson> {
  const existing = await findByPhone(phone);
  if (existing) {
    logger.debug("litify_person_found", { id: existing.Id });
    return existing;
  }
  const conn = await litifyAuth.getConnection();
  const lastName = input.lastName ?? input.firstName ?? "Unknown";
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
}
