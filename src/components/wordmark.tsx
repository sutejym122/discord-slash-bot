import Link from "next/link";

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden
        className="grid size-6 place-items-center rounded-md bg-ink font-mono text-[13px] leading-none text-bg"
      >
        /
      </span>
      Slash Bot
    </Link>
  );
}
