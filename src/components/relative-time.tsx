"use client";

import { useEffect, useState } from "react";

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

function format(date: Date, now: number) {
  const seconds = Math.round((date.getTime() - now) / 1000);
  if (Math.abs(seconds) < 45) return seconds > 5 ? "in a few seconds" : "just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size || unit === "minute")
      return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(seconds, "second");
}

export function RelativeTime({ value, className }: { value: string | Date; className?: string }) {
  const date = typeof value === "string" ? new Date(value) : value;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()} className={className}>
      {now === null ? date.toISOString().slice(11, 16) : format(date, now)}
    </time>
  );
}
