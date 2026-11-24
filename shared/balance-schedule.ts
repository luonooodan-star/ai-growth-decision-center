// Beijing 10:00 and 18:00 are 02:00 and 10:00 UTC, year-round.
export function scheduledBalanceMinute(now = Date.now()): number | null {
  const minute = Math.floor(now / 60000);
  const utcMinute = minute % 1440;
  return utcMinute === 120 || utcMinute === 600 ? minute : null;
}
