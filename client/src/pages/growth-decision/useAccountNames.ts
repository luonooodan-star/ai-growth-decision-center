import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

// Page-local metadata only: no credentials and no advertising mutation.
export function useAccountNames(ids: string[], revision: number) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const cached = useRef(new Map<string, number>());
  const lastRevision = useRef(revision);
  const key = [...new Set(ids.filter((id) => /^\d{1,40}$/.test(id)))]
    .sort()
    .join(',');
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    if (lastRevision.current !== revision) {
      cached.current.clear();
      lastRevision.current = revision;
    }
    const queue = (key ? key.split(',') : []).filter(
      (id) => (cached.current.get(id) || 0) < Date.now(),
    );
    setPending(queue.length > 0);
    (async () => {
      // Ten accounts per request, two upstream reads at a time. Never block the table.
      while (queue.length && live) {
        const batch = queue.splice(0, 10);
        try {
          const { data } = await axios.post<{
            accounts: { id: string; name: string }[];
          }>(
            '/api/growth-decision/adjustments/account-names',
            { accountIds: batch },
            { signal: controller.signal, timeout: 45000 },
          );
          if (live) {
            for (const id of batch)
              cached.current.set(id, Date.now() + 5 * 60000);
            if (cached.current.size > 500) cached.current.clear();
            setNames((old) => ({
              ...old,
              ...Object.fromEntries(
                data.accounts
                  .filter((a) => batch.includes(a.id))
                  .map((a) => [a.id, a.name]),
              ),
            }));
          }
        } catch {
          if (live) {
            for (const id of batch) cached.current.set(id, Date.now() + 60000);
            break;
          }
          /* Keep ID-only filtering usable when authorization/adapter is unavailable. */
        }
      }
      if (live) setPending(false);
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [key, revision]);
  return { names, pending };
}
