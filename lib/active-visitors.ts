// In-memory active visitor tracker (visitorId -> timestamp).
//
// The window matches the heartbeat cadence in components/PresenceHeartbeat:
// a visitor re-pings at most every 10 minutes, so a 5-minute window would
// make everyone look offline between pings. 15 minutes keeps the count
// honest without asking browsers to ping more often.
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const activeVisitors = new Map<string, number>();

export function recordActiveVisitor(visitorId: string): number {
  const now = Date.now();
  activeVisitors.set(visitorId, now);

  const cutoff = now - ACTIVE_WINDOW_MS;
  for (const [id, timestamp] of activeVisitors.entries()) {
    if (timestamp < cutoff) {
      activeVisitors.delete(id);
    }
  }

  return getActiveVisitorsCount();
}

export function getActiveVisitorsCount(): number {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  let count = 0;
  for (const [, timestamp] of activeVisitors.entries()) {
    if (timestamp >= cutoff) count++;
  }
  return Math.max(count, 1);
}
