import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/wordmark";
import { getSession } from "@/server/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const target = typeof next === "string" && next.startsWith("/dashboard") ? next : "/dashboard";
  if (await getSession()) redirect(target);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col px-6 py-16">
      <Wordmark />
      <div className="my-auto py-16 enter">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-ink-2">Use the admin account you were given.</p>
        <LoginForm next={target} />
      </div>
    </main>
  );
}
