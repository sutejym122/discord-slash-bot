import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-6 py-24">
      <p className="font-mono text-sm text-ink-3">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        The page doesn't exist, or it belongs to a server your account can't manage.
      </p>
      <div className="mt-8">
        <ButtonLink href="/dashboard">Back to servers</ButtonLink>
      </div>
    </main>
  );
}
