import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import type { FacebookBalanceRow } from '@shared/meta-adjustment';
import { Button } from '@/components/ui/button';
import TikTokBalancePage from './TikTokBalancePage';

type Report = {
  rows: FacebookBalanceRow[];
  updatedAt?: string;
  error?: string;
};
const centCurrencies = new Set(
  'USD EUR GBP AUD CAD CHF CNY HKD SGD NZD BRL INR MYR THB PHP MXN AED ZAR'.split(
    ' ',
  ),
);
const wholeCurrencies = new Set(['JPY', 'KRW', 'VND', 'CLP', 'PYG']);
function money(raw: string | null, currency: string) {
  if (raw === null) return '未返回';
  if (wholeCurrencies.has(currency)) return raw;
  if (!centCurrencies.has(currency)) return raw + '（API 基本单位）';
  const digits = raw.replace(/^-/, '').padStart(3, '0');
  return (
    (raw.startsWith('-') ? '-' : '') +
    digits.slice(0, -2) +
    '.' +
    digits.slice(-2)
  );
}
function remaining(row: FacebookBalanceRow) {
  if (row.spend_cap === null) return '未返回';
  if (BigInt(row.spend_cap) === BigInt(0)) return '无上限';
  if (row.amount_spent === null) return '未返回';
  const left = BigInt(row.spend_cap) - BigInt(row.amount_spent);
  return money(left > BigInt(0) ? String(left) : '0', row.currency);
}

function FacebookBalances() {
  const [report, setReport] = useState<Report>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const pending = useRef<AbortController | null>(null);
  async function load(manual = false) {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    try {
      const { data } = await axios.request<Report>({
        method: manual ? 'post' : 'get',
        url: '/api/center/facebook/balances' + (manual ? '/refresh' : ''),
        signal: request.signal,
      });
      if (!request.signal.aborted) {
        setReport(data);
        setError(data.error || '');
      }
    } catch (e) {
      if (!request.signal.aborted) {
        setReport(undefined);
        setError(
          axios.isAxiosError(e)
            ? e.response?.data?.message || '查询失败，请重试'
            : '查询失败',
        );
      }
    } finally {
      if (pending.current === request) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 12 * 3600000);
    return () => {
      window.clearInterval(timer);
      pending.current?.abort();
      pending.current = null;
    };
  }, []);
  const query = keyword.trim().toLowerCase();
  const rows =
    report?.rows.filter(
      (row) =>
        row.name.toLowerCase().includes(query) ||
        ('act_' + row.id).includes(query),
    ) || [];
  return (
    <section className="mx-auto max-w-6xl space-y-5 px-5 py-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Facebook 账户余额</h1>
          <p className="mt-2 text-sm text-slate-500">
            使用我的 Meta 授权，北京时间上午、下午各自动刷新一次。
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void load(true)}
          disabled={busy}
        >
          {busy ? '查询中…' : '刷新余额'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error} ·{' '}
          <Link className="underline" to="/authorization">
            查看授权与连接
          </Link>
        </p>
      )}
      <input
        className="w-full max-w-md rounded-md border px-3 py-2"
        aria-label="搜索 FB 账户"
        placeholder="搜索账户名称或账户 ID"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />
      {report?.updatedAt && (
        <p className="text-sm text-slate-500">
          显示 {rows.length} / {report.rows.length} 个账户 · 最近更新{' '}
          {new Date(report.updatedAt).toLocaleString('zh-CN')}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-sm">
          <thead>
            <tr>
              {[
                '账户名称 / ID',
                '币种',
                '待付账款',
                '花费上限',
                '已花费',
                '剩余额度',
              ].map((h) => (
                <th className="border-b p-3" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="border-b p-3">
                  {r.name || '未命名账户'}
                  <div className="text-slate-500">{r.id}</div>
                </td>
                {[
                  r.currency || '未返回',
                  money(r.balance, r.currency),
                  r.spend_cap !== null && BigInt(r.spend_cap) === BigInt(0)
                    ? '无上限'
                    : money(r.spend_cap, r.currency),
                  money(r.amount_spent, r.currency),
                  remaining(r),
                ].map((v, i) => (
                  <td className="border-b p-3 tabular-nums" key={i}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!busy && !error && !rows.length && (
        <p>{query ? '没有匹配的账户' : '当前个人授权未返回广告账户'}</p>
      )}
      <p className="text-sm text-slate-500">
        剩余额度按账户花费上限减去已花费计算。Meta 未提供的金额显示为“未返回”。
      </p>
    </section>
  );
}
export default function AccountBalancePage() {
  const [params, setParams] = useSearchParams();
  const fb = params.get('channel') === 'fb';
  return (
    <>
      <nav
        aria-label="广告平台"
        className="mx-auto flex max-w-6xl gap-2 px-5 pt-6"
      >
        {['TikTok', 'Facebook'].map((name, i) => (
          <Button
            key={name}
            variant={fb === Boolean(i) ? 'default' : 'outline'}
            aria-pressed={fb === Boolean(i)}
            onClick={() => setParams(i ? { channel: 'fb' } : {})}
          >
            {name}
          </Button>
        ))}
      </nav>
      {fb ? <FacebookBalances /> : <TikTokBalancePage />}
    </>
  );
}
