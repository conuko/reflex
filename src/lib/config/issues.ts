// Issues created from a ticket (plan M5). The title starts as the ticket's
// subject, cut to this length, and the person may edit it; the body is the
// first customer message, copied. Jev doesn't write text (ADR-0003).

export const ISSUE_TITLE_MAX_CHARS = 200;

export function defaultIssueTitle(subject: string): string {
  return subject.trim().slice(0, ISSUE_TITLE_MAX_CHARS);
}
