"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass, Spinner } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setPending(false);
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : error.status === 401
            ? "That email and password don't match."
            : "Couldn't sign in right now. Try again in a moment.",
      );
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 grid gap-5">
      <Field label="Email" htmlFor="email">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className={inputClass}
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending} className="mt-1">
        {pending && <Spinner />}
        {pending ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}
