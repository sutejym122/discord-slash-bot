import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:bg-ink/85 disabled:bg-ink/40",
  secondary:
    "bg-surface text-ink border border-line-strong hover:border-ink-3 hover:bg-surface-2 disabled:text-ink-3",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2 disabled:text-ink-3",
  danger: "bg-surface text-bad border border-line-strong hover:border-bad hover:bg-bad-soft",
};

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed select-none whitespace-nowrap";
const sizes = { sm: "h-8 px-3", md: "h-10 px-4" };

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof sizes }) {
  return (
    <button
      type="button"
      className={cx(buttonBase, sizes[size], variants[variant], className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <Link className={cx(buttonBase, sizes[size], variants[variant], className)} {...props} />;
}

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

const tones: Record<Tone, { pill: string; dot: string }> = {
  ok: { pill: "bg-ok-soft text-ok", dot: "bg-ok" },
  warn: { pill: "bg-warn-soft text-warn", dot: "bg-warn" },
  bad: { pill: "bg-bad-soft text-bad", dot: "bg-bad" },
  info: { pill: "bg-info-soft text-info", dot: "bg-info" },
  neutral: { pill: "bg-surface-2 text-ink-2", dot: "bg-ink-3" },
};

export function Pill({
  tone = "neutral",
  pulse,
  children,
  title,
}: {
  tone?: Tone;
  pulse?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        tones[tone].pill,
      )}
    >
      <span className={cx("size-1.5 rounded-full", tones[tone].dot, pulse && "pulse")} />
      {children}
    </span>
  );
}

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className={cx("inline-block size-2 rounded-full", tones[tone].dot, pulse && "pulse")} />
  );
}

export function Section({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-6 border-t border-line py-10 first:border-t-0 first:pt-2 md:grid-cols-[minmax(0,280px)_1fr] md:gap-12">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{description}</p>}
        {aside}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-bad" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs leading-relaxed text-ink-3">{hint}</p>
      )}
    </div>
  );
}

export const inputClass =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 transition-colors hover:border-ink-3 focus:border-ink focus:outline-none disabled:bg-surface-2 disabled:text-ink-3";

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      {children && (
        <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">{children}</div>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={cx("rounded-lg px-4 py-3 text-sm leading-relaxed", tones[tone].pill)}>
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cx("size-4 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
