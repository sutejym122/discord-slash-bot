"use client";

import { useState, useTransition } from "react";

type Result = { ok: true; message?: string } | { ok: false; error: string };

export function useAction<A extends unknown[], R extends Result>(
  action: (...args: A) => Promise<R>,
) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<R | null>(null);

  function run(...args: A) {
    setResult(null);
    return new Promise<R>((resolve) => {
      startTransition(async () => {
        try {
          const r = await action(...args);
          setResult(r);
          resolve(r);
        } catch {
          const r = { ok: false, error: "Couldn't reach the server. Check your connection." } as R;
          setResult(r);
          resolve(r);
        }
      });
    });
  }

  return { pending, result, run, clear: () => setResult(null) };
}
