"use client";

import { cx } from "./ui";

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <label htmlFor={id} className={cx("text-sm font-medium", disabled && "text-ink-3")}>
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40",
          checked ? "bg-ok" : "bg-line-strong",
        )}
      >
        <span
          className={cx(
            "inline-block size-5 rounded-full bg-white shadow-sm transition-transform duration-200",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
