import type { z } from "zod";

// What a command answers when its input doesn't fit: messages per field, so a
// form can show each next to its field. Commands throw only for what a form
// can't fix (a missing ticket, a broken database).

/** Messages per field path, e.g. `featureDemand.mediumArr`. */
export type FieldErrors = Record<string, string[]>;

export type Invalid = { ok: false; errors: FieldErrors };

export function fieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "(form)";
    errors[path] = [...(errors[path] ?? []), issue.message];
  }
  return errors;
}

export function invalid(field: string, message: string): Invalid {
  return { ok: false, errors: { [field]: [message] } };
}

/** A ticket, issue or workspace the command was given doesn't exist. */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}
