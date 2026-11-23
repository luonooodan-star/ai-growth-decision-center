import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';

type Report =
  | { configured: false }
  | {
      configured: true;
      summaries?: string[];
      error?: string;
      updatedAt?: string;
      rows: {
        id: string;
        name: string;
        centers?: string[];
        owner?: string;
        assignee?: string;
        detailBalance?: boolean;
        currency: string;
        remaining?: string;
        webBudget?: {
          period: string;
          total: string;
          spent: string;
          remaining: string;
          currency: string;
          updatedAt: string;
        };
        webBudgetError?: string;
        reminder: boolean;
        balance: string | null;
      }[];
    };

export default function TikTokBalancePage() {
  const [report, setReport] = useState<Report>();
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async (manual = false) => {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    try {
      const { data } = await axios.request<Report>({
        method: manual ? 'post' : 'get',
        url: '/api/center/tiktok/balances' + (manual ? '/refresh' : ''),
        signal: request.signal,
      });
      if (!request.signal.aborted) {
        setReport(data);
        setError(data.configured ? data.error || '' : '');
      }
    } catch (e) {
      if (!request.signal.aborted) {
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
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 12 * 3600000);
    return () => {
      window.clearInterval(timer);
      pending.current?.abort();
      pending.current = null;
    };
  }, [refresh]);
  const query = keyword.trim().toLowerCase();
  const matches = report?.configured
    ? report.rows.filter(
        (row) =>
          row.id.includes(query) ||
          row.assignee?.includes(query) ||
          row.name.toLowerCase().includes(query) ||
          row.owner?.toLowerCase().includes(query) ||
          row.centers?.some((c) => c.toLowerCase().includes(query)),
      )
    : [];
  return (
    <section className="mx-auto max-w-6xl space-y-5 px-5 py-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">TikTok 账户余额</h1>
          <p className="mt-2 text-sm text-slate-500">
            每日按北京时间上、下午各自动抓取一次。启用 Payment Portfolio
            的账户可能共用同一余额。
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void refresh(true)}
          disabled={busy}
        >
          {busy ? '查询中…' : '刷新余额'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {report?.configured === false && (
        <div className="rounded-xl border bg-white p-5">
          共享上传 Access-Token 尚未配置。请在公司 Mac 的决策中心仓库运行{' '}
          <code>python3 scripts/company-mac/setup-tiktok-balance.py</code>
          ，录入上传工具的 Token 后刷新。
        </div>
      )}
      {report?.configured && (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <input
            aria-label="筛选账户"
            placeholder="输入归属人、账户名称、ID 或 BC"
            className="m-3 w-72 rounded-md border p-2 text-sm"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <p className="border-b px-4 py-3 text-sm text-slate-500">
            {matches.length} / {report.rows.length} 个账户 · 最近更新
            {report.updatedAt
              ? new Date(report.updatedAt).toLocaleString('zh-CN')
              : '尚无成功抓取'}
          </p>
          {report.summaries?.map((summary, i) => (
            <p className="px-4 py-1 text-sm" key={i}>
              {summary}
            </p>
          ))}
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                {[
                  '可见 BC',
                  '所属 BC',
                  '归属人',
                  '广告账户',
                  '账户 ID',
                  '币种',
                  '余额',
                  '账户剩余预算',
                ].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matches.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3">{row.centers?.join('、') || '—'}</td>
                  <td className="p-3">{row.owner || '—'}</td>
                  <td className="p-3">{row.assignee || '—'}</td>
                  <td className="p-3">{row.name || '—'}</td>
                  <td className="p-3">{row.id}</td>
                  <td className="p-3">{row.currency || '—'}</td>
                  <td className="p-3 tabular-nums">
                    {row.balance ?? '未返回'}{' '}
                    {row.balance !== null && (
                      <small>
                        {row.detailBalance ? '账户详情' : 'BC 可用余额'}
                      </small>
                    )}{' '}
                    {row.reminder && (
                      <span className="ml-2 text-amber-700">需补款</span>
                    )}
                  </td>
                  <td className="p-3 tabular-nums">
                    {row.webBudget ? (
                      <>
                        <strong>
                          {row.webBudget.remaining} {row.webBudget.currency}
                        </strong>
                        <small className="block text-slate-500">
                          {row.webBudgetError ? '上次成功读取' : 'Ads Manager'}{' '}
                          ·{' '}
                          {new Date(row.webBudget.updatedAt).toLocaleString(
                            'zh-CN',
                          )}
                        </small>
                        <small className="block text-slate-500">
                          {row.webBudget.period}预算 {row.webBudget.total} ·
                          已花费 {row.webBudget.spent}
                        </small>
                      </>
                    ) : (
                      (row.remaining ?? '未返回')
                    )}
                    {row.webBudgetError && (
                      <small className="block text-amber-700">
                        {row.webBudgetError}
                      </small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!matches.length && (
            <p className="p-5 text-sm">
              {query ? '没有匹配的账户。' : '暂无账户余额记录。'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
