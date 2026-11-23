import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';

export type WebBudget = {
  period: '单次' | '每日' | '每月';
  total: string;
  spent: string;
  remaining: string;
  currency: string;
  updatedAt: string;
};

const amount = /(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([A-Z]{3})/.source;
const budgetCard = new RegExp(
  '(?:(One[- ]time|Daily|Monthly) budget is|(单次|單次|每日|每天|每月)\\s*(?:预算为|預算為))\\s*' +
    amount +
    '[.。]?\\s*(?:Spent(?: budget)?|已花费预算|已花費預算)\\s*' +
    amount +
    '\\s*(?:Remaining(?: budget)?|剩余预算|剩餘預算)\\s*' +
    amount,
  'gi',
);

export function parseBudgetCard(
  text: string,
): Omit<WebBudget, 'updatedAt'> | undefined {
  const matches = Array.from(text.replace(/\s+/g, ' ').matchAll(budgetCard));
  if (matches.length !== 1) return;
  const [
    ,
    englishPeriod,
    chinesePeriod,
    total,
    currency,
    spent,
    spentCurrency,
    remaining,
    remainingCurrency,
  ] = matches[0];
  if (currency !== spentCurrency || currency !== remainingCurrency) return;
  return {
    period: /daily|每日|每天/i.test(englishPeriod || chinesePeriod)
      ? '每日'
      : /monthly|每月/i.test(englishPeriod || chinesePeriod)
        ? '每月'
        : '单次',
    total: total.replace(/,/g, ''),
    spent: spent.replace(/,/g, ''),
    remaining: remaining.replace(/,/g, ''),
    currency,
  };
}

export async function webBudgetAccounts(folder: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(join(folder, 'web-budget-accounts.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const ids = JSON.parse(raw);
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== 'string' || !/^\d{1,24}$/.test(id))
  )
    throw new Error('月结账户清单格式无效');
  return Array.from(new Set<string>(ids));
}
const loginHint =
  '请在公司 Mac 运行 node scripts/company-mac/login-tiktok-budget.mjs，登录后退出专用 Chrome，再手动刷新';
class LoginRequired extends Error {}

async function readCard(page: Page, id: string): Promise<WebBudget> {
  const target = new URL('https://ads.tiktok.com/i18n/account/payment');
  target.searchParams.set('aadvid', id);
  try {
    await page.goto(target.href, {
      waitUntil: 'domcontentloaded',
      timeout: 35000,
    });
  } catch (error) {
    if (/login|passport|challenge|captcha/i.test(new URL(page.url()).pathname))
      throw new LoginRequired(loginHint);
    throw error;
  }
  const deadline = Date.now() + 20000;
  do {
    // Read identity and visible text from the same document.
    const view = await page.evaluate(() => ({
      url: location.href,
      text: document.body?.innerText || '',
    }));
    const url = new URL(view.url);
    if (/login|passport|challenge|captcha/i.test(url.pathname))
      throw new LoginRequired(loginHint);
    if (
      url.origin === target.origin &&
      url.pathname.replace(/\/$/, '') === target.pathname &&
      url.searchParams.get('aadvid') === id
    ) {
      const card = parseBudgetCard(view.text);
      if (card) return { ...card, updatedAt: new Date().toISOString() };
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  } while (Date.now() < deadline);
  throw new Error('未读到该账户的预算卡片，请用专用 Chrome 检查付款页');
}

export async function collectWebBudgets(folder: string, ids: string[]) {
  const results = new Map<string, { budget?: WebBudget; error?: string }>();
  if (!ids.length) return results;
  let context: BrowserContext;
  try {
    const { chromium } = await import('playwright-core');
    context = await chromium.launchPersistentContext(
      join(folder, 'budget-chrome'),
      {
        channel: 'chrome',
        // Match the macOS Keychain used by the interactive Google Chrome login.
        ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'],
        headless: true,
        chromiumSandbox: true,
        timeout: 30000,
      },
    );
    for (const id of ids) {
      const page = await context.newPage();
      try {
        results.set(id, { budget: await readCard(page, id) });
      } catch (error) {
        if (error instanceof LoginRequired) throw error;
        results.set(id, {
          error:
            error instanceof Error && error.message.startsWith('未读到')
              ? error.message
              : '付款页读取失败，请检查公司 Mac 的网络及账户访问权限',
        });
      } finally {
        await page.close();
      }
    }
  } catch (error) {
    const message =
      error instanceof LoginRequired
        ? loginHint
        : '专用 Chrome 启动或连接失败。' + loginHint;
    for (const id of ids)
      if (!results.has(id)) results.set(id, { error: message });
  } finally {
    await context?.close().catch(() => undefined);
  }
  return results;
}
