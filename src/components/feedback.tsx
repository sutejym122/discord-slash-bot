import { cx } from "./ui";

export function Feedback({
  result,
}: {
  result: { ok: true; message?: string } | { ok: false; error: string } | null;
}) {
  if (!result || (result.ok && !result.message)) return null;
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className={cx("text-sm enter", result.ok ? "text-ok" : "text-bad")}
    >
      {result.ok ? result.message : result.error}
    </p>
  );
}
