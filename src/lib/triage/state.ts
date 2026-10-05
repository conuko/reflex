// The state a judgment provider sees: only the ticket's subject and messages.
// Plan, ARR, spikes and demand stay in code (ADR-0001). Long threads keep the
// first message plus the last 3, and every text is capped, so a request stays
// well inside the model's token budget.

export type TicketMessage = { from: "customer" | "support"; text: string };

export type TicketInput = { subject: string; messages: readonly TicketMessage[] };

export type TicketState = { ticket: { subject: string; messages: TicketMessage[] } };

export const SUBJECT_MAX_CHARS = 250;
export const MESSAGE_MAX_CHARS = 2_500;
const LAST_MESSAGES = 3;

export function buildState({ subject, messages }: TicketInput): TicketState {
  const kept =
    messages.length <= LAST_MESSAGES + 1
      ? messages
      : [...messages.slice(0, 1), ...messages.slice(-LAST_MESSAGES)];

  return {
    ticket: {
      subject: capText(subject, SUBJECT_MAX_CHARS),
      messages: kept.map(({ from, text }) => ({ from, text: capText(text, MESSAGE_MAX_CHARS) })),
    },
  };
}

/** Cuts `text` to at most `max` characters, ending a cut text with "…". */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  // Drop a dangling high surrogate: a lone one is invalid UTF-16 in the request.
  return `${text.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
}
