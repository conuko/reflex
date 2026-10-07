import type { Redis } from "ioredis";

import { z } from "zod";

// Live invalidation hints for the browser (plan M4): the worker and commands
// publish what changed on one Redis channel, and `/api/events` streams it as
// Server-Sent Events. A hint carries ids only; clients refetch on every hint,
// on open and on reconnect, so a missed hint costs nothing but a delay.

export const EVENTS_CHANNEL = "reflex:events";
export const HEARTBEAT_MS = 15_000;

export const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ticket"), ticketId: z.string() }),
  z.object({ type: z.literal("incident"), incidentId: z.string() }),
  z.object({ type: z.literal("policy"), version: z.int() }),
  z.object({ type: z.literal("reset") }),
]);

export type ReflexEvent = z.infer<typeof eventSchema>;

export async function publishEvent(redis: Redis, event: ReflexEvent): Promise<void> {
  await redis.publish(EVENTS_CHANNEL, JSON.stringify(eventSchema.parse(event)));
}

/**
 * An SSE stream of events from a dedicated subscriber connection. The stream
 * sends a comment every `heartbeatMs` so proxies keep it open, and when
 * `signal` aborts (the browser went away) it unsubscribes, closes the
 * connection and ends.
 */
export function openEventStream({
  subscriber,
  signal,
  heartbeatMs = HEARTBEAT_MS,
}: {
  subscriber: Redis;
  signal: AbortSignal;
  heartbeatMs?: number;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const close = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        subscriber.removeAllListeners("message");
        await subscriber.unsubscribe(EVENTS_CHANNEL).catch(() => undefined);
        subscriber.disconnect();
        controller.close();
      };

      subscriber.on("message", (channel: string, message: string) => {
        if (channel === EVENTS_CHANNEL) send(`data: ${message}\n\n`);
      });
      await subscriber.subscribe(EVENTS_CHANNEL);
      // Tells the client the stream is live, so it refetches once now.
      send("event: open\ndata: {}\n\n");
      heartbeat = setInterval(() => send(": heartbeat\n\n"), heartbeatMs);

      if (signal.aborted) await close();
      else signal.addEventListener("abort", () => void close(), { once: true });
    },
  });
}
