import { webEnv } from "@/lib/env";
import { openEventStream } from "@/lib/events";
import { createRedis } from "@/lib/redis";

// Server-Sent Events of invalidation hints (plan M4). Each connection gets its
// own subscriber, closed when the browser goes away; see src/lib/events.ts.
export function GET(request: Request) {
  const stream = openEventStream({
    subscriber: createRedis(webEnv().REDIS_URL),
    signal: request.signal,
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
