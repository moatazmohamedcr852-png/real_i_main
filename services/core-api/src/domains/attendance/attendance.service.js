export function calculatePresence(record, session, asOf = new Date()) {
  const windowStart = new Date(session.startsAt).getTime();
  const windowEnd = Math.min(new Date(session.endsAt).getTime(), new Date(asOf).getTime());
  const durationSeconds = Math.max(0, Math.floor((new Date(session.endsAt).getTime() - windowStart) / 1000));
  const secondsWithinWindow = (start, end) => Math.max(0, Math.floor((Math.min(new Date(end).getTime(), windowEnd) - Math.max(new Date(start).getTime(), windowStart)) / 1000));
  const completedSeconds = (record.intervals ?? []).reduce((sum, interval) => sum + secondsWithinWindow(interval.joinedAt, interval.leftAt), 0);
  const activeSeconds = record.activeJoinedAt ? secondsWithinWindow(record.activeJoinedAt, asOf) : 0;
  const totalSeconds = completedSeconds + activeSeconds;
  return { totalSeconds, sessionDurationSeconds: durationSeconds, presencePercentage: durationSeconds ? Math.min(100, Math.round((totalSeconds / durationSeconds) * 10000) / 100) : 0 };
}
