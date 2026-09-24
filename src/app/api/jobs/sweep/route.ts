import { handleSweepRequest } from "@/server/jobs/sweep";

export const maxDuration = 60;

export const GET = (req: Request) => handleSweepRequest(req);
export const POST = (req: Request) => handleSweepRequest(req);
