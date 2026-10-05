import { describe, expect, it } from "vitest";

import type { TicketMessage } from "@/lib/triage/state";

import { buildState, MESSAGE_MAX_CHARS, SUBJECT_MAX_CHARS } from "@/lib/triage/state";

const customer = (text: string): TicketMessage => ({ from: "customer", text });
const support = (text: string): TicketMessage => ({ from: "support", text });

describe("buildState", () => {
  it("holds the subject and every message of a short thread", () => {
    const ticket = {
      subject: "Agents stopped running",
      messages: [customer("Our agents fail since this morning."), support("Looking into it.")],
    };

    expect(buildState(ticket)).toEqual({
      ticket: {
        subject: "Agents stopped running",
        messages: [
          { from: "customer", text: "Our agents fail since this morning." },
          { from: "support", text: "Looking into it." },
        ],
      },
    });
  });

  it("keeps the first message plus the last 3 of a longer thread", () => {
    const messages = ["m1", "m2", "m3", "m4", "m5", "m6"].map(customer);

    const state = buildState({ subject: "Long thread", messages });

    expect(state.ticket.messages.map((m) => m.text)).toEqual(["m1", "m4", "m5", "m6"]);
  });

  it("keeps all 4 messages of a 4-message thread", () => {
    const messages = ["m1", "m2", "m3", "m4"].map(customer);

    const state = buildState({ subject: "Four", messages });

    expect(state.ticket.messages.map((m) => m.text)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("caps each message at 2,500 characters", () => {
    const state = buildState({ subject: "Logs", messages: [customer("x".repeat(9_000))] });

    expect(MESSAGE_MAX_CHARS).toBe(2_500);
    expect(state.ticket.messages[0]?.text).toHaveLength(2_500);
    expect(state.ticket.messages[0]?.text.endsWith("…")).toBe(true);
  });

  it("never cuts an emoji in half", () => {
    const text = `${"x".repeat(2_498)}😀 and more`;

    const state = buildState({ subject: "Emoji", messages: [customer(text)] });

    expect(state.ticket.messages[0]?.text).toBe(`${"x".repeat(2_498)}…`);
  });

  it("leaves a message of exactly 2,500 characters untouched", () => {
    const text = "y".repeat(2_500);

    const state = buildState({ subject: "Exact", messages: [customer(text)] });

    expect(state.ticket.messages[0]?.text).toBe(text);
  });

  it("caps the subject", () => {
    const state = buildState({ subject: "s".repeat(1_000), messages: [customer("Hi")] });

    expect(state.ticket.subject).toHaveLength(SUBJECT_MAX_CHARS);
  });

  it("holds nothing but the subject and messages", () => {
    // A ticket row carries more than the model may see.
    const message = { ...customer("Charged twice"), sentAt: "2026-10-01" };
    const ticket = {
      subject: "Billing",
      messages: [message],
      plan: "enterprise",
      arr: 120_000,
      workspaceId: "ws_1",
    };

    expect(buildState(ticket)).toEqual({
      ticket: { subject: "Billing", messages: [{ from: "customer", text: "Charged twice" }] },
    });
  });
});
