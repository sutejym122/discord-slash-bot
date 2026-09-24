import { createAuthClient } from "better-auth/react";

// Same-origin client. It only talks to /api/auth; no secrets or config live here.
export const authClient = createAuthClient();
