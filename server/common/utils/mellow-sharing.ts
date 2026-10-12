// Explicit business-data grant only. Never use this for Meta or general BI routes.
export const isMellowRecipient = (username?: string) =>
  username === 'fjx' || username === 'jsa';
export const canReadMellowShared = (username?: string) =>
  username === 'growth' || isMellowRecipient(username);
export function isMellowSharedRoute(
  method: string,
  path: string,
  username: string,
) {
  if (!canReadMellowShared(username)) return false;
  if (method === 'POST' && path === '/api/growth-decision/analysis/mellow-roas')
    return true;
  if (!isMellowRecipient(username)) return false;
  return (
    (method === 'POST' && path === '/api/growth-decision/analysis/query') ||
    (['GET', 'DELETE'].includes(method) &&
      /^\/api\/growth-decision\/analysis\/query\/[a-f0-9-]{36}$/.test(path))
  );
}
