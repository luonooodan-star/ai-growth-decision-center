import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

type Alert = { id: string; message: string; web: boolean };
export default function TikTokBalanceAlert({ username }: { username: string }) {
  const [alert, setAlert] = useState<Alert | null>(null);
  const key = 'tt-balance-alert:' + username;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const controller = new AbortController();
    let sequence = 0;
    async function check() {
      if (document.hidden) return;
      const current = ++sequence;
      try {
        const { data } = await axios.get<{ alert: Alert | null }>(
          '/api/center/tiktok/balances/alert',
          { signal: controller.signal },
        );
        if (!controller.signal.aborted && current === sequence)
          setAlert(data.alert);
      } catch {
        /* Retry on focus or the next poll. */
      }
    }
    void check();
    const timer = window.setInterval(check, 60000);
    window.addEventListener('focus', check);
    window.addEventListener('tiktok-balance-updated', check);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('tiktok-balance-updated', check);
    };
  }, []);
  if (!alert || dismissed === alert.id) return null;
  function dismiss() {
    setDismissed(alert!.id);
    try {
      sessionStorage.setItem(key, alert!.id);
    } catch {
      /* In-memory dismissal still applies. */
    }
  }
  return (
    <aside
      role="alert"
      className="fixed bottom-5 right-5 z-50 max-h-[75vh] w-96 max-w-[90vw] overflow-auto rounded-xl border border-amber-400 bg-white p-5 text-sm shadow-xl"
    >
      <strong>TT 账户余额抓取失败</strong>
      <p className="my-2 break-words">{alert.message}</p>
      {alert.web && (
        <p>
          如需重新登录，请在公司 Mac 打开「账户余额」并点「刷新余额」，在专用
          Chrome 窗口中完成登录。
        </p>
      )}
      <div className="mt-3 flex gap-5">
        <Link
          className="text-blue-700 underline"
          to="/balances"
          onClick={dismiss}
        >
          查看 TT 余额
        </Link>
        <button onClick={dismiss}>知道了</button>
      </div>
    </aside>
  );
}
