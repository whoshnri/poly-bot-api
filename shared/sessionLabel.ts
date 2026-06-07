export function buildSessionName(createdAt: Date = new Date()): string {
  return createdAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildSessionNameFromPreSession(
  topic: string,
  marketQuestion?: string,
): string {
  const source = marketQuestion?.trim() || topic.trim();
  if (source.length === 0) {
    return buildSessionName();
  }

  const maxLength = 48;
  if (source.length <= maxLength) {
    return source;
  }

  return `${source.slice(0, maxLength - 1)}…`;
}
