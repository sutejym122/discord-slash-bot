import { cx } from "./ui";

export function GuildIcon({
  guild,
  size = 40,
}: {
  guild: { id: string; name: string; icon: string | null };
  size?: number;
}) {
  const initials = guild.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return guild.icon ? (
    // biome-ignore lint/performance/noImgElement: tiny CDN avatar, next/image adds nothing here
    <img
      src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=${size * 2}`}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-xl"
    />
  ) : (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cx(
        "grid shrink-0 place-items-center rounded-xl bg-surface-2 text-sm font-semibold text-ink-2",
      )}
    >
      {initials}
    </span>
  );
}
