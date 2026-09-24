import { after } from "next/server";
import { handleInteractionRequest } from "@/server/interactions/endpoint";

export async function POST(req: Request) {
  return handleInteractionRequest(req, { schedule: after });
}
