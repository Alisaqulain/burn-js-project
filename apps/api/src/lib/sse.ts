/**
 * Formats one Server-Sent Event frame. Multi-line data is split into multiple `data:` lines as the
 * SSE specification requires; field values never contain raw newlines.
 */
export function formatSseEvent(event: { event?: string; data: unknown; id?: string | number; retry?: number }): string {
  let frame = "";
  if (event.id !== undefined) frame += `id: ${String(event.id).replace(/[\r\n]/g, "")}\n`;
  if (event.event) frame += `event: ${event.event.replace(/[\r\n]/g, "")}\n`;
  if (event.retry !== undefined) frame += `retry: ${Math.max(0, Math.floor(event.retry))}\n`;
  const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
  for (const line of data.split(/\r\n|\r|\n/)) frame += `data: ${line}\n`;
  return `${frame}\n`;
}

/** A comment frame used as a heartbeat to keep proxies and idle timeouts from closing the stream. */
export function formatSseComment(comment: string): string {
  return `: ${comment.replace(/[\r\n]/g, " ")}\n\n`;
}
