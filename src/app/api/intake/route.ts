import { handleIntake, SIGNATURE_HEADER } from "@/lib/commands/intake";
import { db } from "@/lib/db";
import { webEnv } from "@/lib/env";
import { queues } from "@/server/queues";

// Signed intake (plan M4); the logic and its tests live in src/lib/commands/intake.ts.
export async function POST(request: Request) {
  const result = await handleIntake(
    { db: db(), queues: queues(), secret: webEnv().INTAKE_WEBHOOK_SECRET },
    { body: await request.text(), signature: request.headers.get(SIGNATURE_HEADER) },
  );
  return Response.json(result.body, { status: result.status });
}
