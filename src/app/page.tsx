import { ButtonLink } from "@/components/ui";
import { Wordmark } from "@/components/wordmark";
import { getSession } from "@/server/session";

const flow = [
  {
    command: "/report",
    body: "Members describe a problem in a short form. The report is triaged by AI, posted to your moderators with Acknowledge and Resolve buttons, and copied to Slack or another Discord channel.",
  },
  {
    command: "/status",
    body: "Anyone can check how the bot is set up here and whether deliveries are healthy, without opening the dashboard.",
  },
  {
    command: "Dashboard",
    body: "A live log of every command and everything the bot did about it, including retries and failures, plus per-server rules.",
  },
];

export default async function Home() {
  const session = await getSession();
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 sm:px-10">
      <header className="flex h-16 items-center justify-between">
        <Wordmark />
        <ButtonLink href={session ? "/dashboard" : "/login"} variant="ghost" size="sm">
          {session ? "Open dashboard" : "Sign in"}
        </ButtonLink>
      </header>

      <main className="flex-1 py-20 sm:py-28">
        <div className="max-w-2xl enter">
          <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
            Reports your moderators actually see.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
            A Discord bot for problem reports and server status, with a dashboard that shows exactly
            what happened to each one.
          </p>
          <div className="mt-10 flex gap-3">
            <ButtonLink href={session ? "/dashboard" : "/login"} variant="primary">
              {session ? "Open dashboard" : "Sign in to the dashboard"}
            </ButtonLink>
          </div>
        </div>

        <dl className="mt-24 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {flow.map((f) => (
            <div key={f.command} className="bg-surface px-6 py-7">
              <dt className="font-mono text-sm font-semibold">{f.command}</dt>
              <dd className="mt-3 text-sm leading-relaxed text-ink-2">{f.body}</dd>
            </div>
          ))}
        </dl>
      </main>

      <footer className="flex h-16 items-center border-t border-line text-xs text-ink-3">
        Built on Discord HTTP interactions. No gateway connection, nothing to keep awake.
      </footer>
    </div>
  );
}
