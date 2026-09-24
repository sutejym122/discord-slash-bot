import { after } from "next/server";
import { handleInteractionRequest } from "@/server/interactions/endpoint";
import { drainJobs } from "@/server/jobs/runner";

// The response goes out within Discord's 3s window; `after` keeps the function alive to run
// this interaction's jobs, bounded well below this limit.
export const maxDuration = 60;

export async function POST(req: Request) {
  return handleInteractionRequest(req, {
    schedule: after,
    onAccepted: async (interactionId) => {
      await drainJobs({ interactionId, budgetMs: 40_000 });
    },
  });
}
