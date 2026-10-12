import type { BiRawRow } from '@shared/paid-growth.interface';
import type {
  CreativeFunnelRow,
  FunnelPlatform,
} from '@shared/creative-analysis.interface';
import { parseCreativeTags, iosCreative } from '@shared/creative-tags';

export const FUNNEL_APPS = [
  {
    appId: 12,
    platform: 'android' as const,
    bundle: 'com.pixelfly.mellow',
    orders: true,
  },
  {
    appId: 3,
    platform: 'ios' as const,
    bundle: 'com.pixelflyapp.milo',
    orders: true,
  },
];
export const FUNNEL_EVENTS = [
  'chat_page_send_message_success',
  'sub_show',
  'purchase_page_view',
  'sub_click',
  'pur_click',
  'sub_success',
  'pur_succ',
];
export interface FunnelCohortUser {
  appId: number;
  platform: FunnelPlatform;
  bundle: string;
  userId: string;
  date: string;
  country: string;
}
const value = (raw: unknown) => (raw == null ? '' : String(raw).trim());
const validId = (raw: unknown) =>
  !['', 'null', 'undefined', '0'].includes(value(raw));
const dateOf = (raw: unknown) => value(raw).slice(0, 10);
export function funnelCohort(firstOpens: BiRawRow[]) {
  const users = new Map<string, FunnelCohortUser>();
  const duplicates = new Set<string>();
  let excluded = 0;
  for (const row of firstOpens) {
    const app = FUNNEL_APPS.find((a) => a.appId === Number(row.app_id));
    if (!app || !validId(row.resolved_user_id)) {
      excluded += Number(row.event_count) || 1;
      continue;
    }
    const key = `${app.appId}:${value(row.resolved_user_id)}`;
    const user: FunnelCohortUser = {
      appId: app.appId,
      platform: app.platform,
      bundle: app.bundle,
      userId: value(row.resolved_user_id),
      date: dateOf(row.event_date),
      country: value(row.geo_country) || '未知国家',
    };
    const previous = users.get(key);
    if (previous) duplicates.add(key);
    if (!previous || user.date < previous.date) users.set(key, user);
    else if (user.date === previous.date && user.country !== previous.country)
      previous.country = '多国家记录';
  }
  return { users: [...users.values()], excluded, duplicates: duplicates.size };
}

/** Rows are mutually exclusive user groups. Raw identifiers never leave the server. */
export function buildCreativeFunnelRows(
  cohort: FunnelCohortUser[],
  input: {
    events: BiRawRow[] | null;
    attribution: BiRawRow[] | null;
    orders: BiRawRow[] | null;
  },
): CreativeFunnelRow[] {
  const events = new Map<string, BiRawRow[]>();
  const attribution = new Map<string, BiRawRow[]>();
  const orders = new Set<string>();
  for (const row of input.events || []) {
    const key = `${row.app_id}:${value(row.resolved_user_id)}:${dateOf(row.event_date)}`;
    const group = events.get(key) || [];
    group.push(row);
    events.set(key, group);
  }
  for (const row of input.attribution || []) {
    const key = `${value(row.bundle_id)}:${value(row.user_id)}`;
    const group = attribution.get(key) || [];
    group.push(row);
    attribution.set(key, group);
  }
  for (const row of input.orders || []) {
    if (row.bundle_id === 'com.pixelflyapp.milo' && Number(row.platform) !== 2)
      continue;
    if (
      value(row.action_desc) !== 'PURCHASED' ||
      value(row.env).toLowerCase() !== 'production' ||
      !(Number(row.order_count) > 0)
    )
      continue;
    orders.add(
      `${value(row.bundle_id)}:${value(row.user_id)}:${dateOf(row.event_date)}`,
    );
  }
  const result = new Map<string, CreativeFunnelRow>();
  for (const user of cohort) {
    const userEvents =
      events.get(`${user.appId}:${user.userId}:${user.date}`) || [];
    const eventNames = new Set(
      userEvents
        .filter((r) => Number(r.event_count) > 0)
        .map((r) => value(r.event_name)),
    );
    const depths = new Map<string, number>();
    let unknownDepth = false;
    for (const row of userEvents) {
      if (
        row.event_name !== 'chat_page_send_message_success' ||
        !(Number(row.event_count) > 0)
      )
        continue;
      if (!validId(row.character_id)) {
        unknownDepth = true;
        continue;
      }
      const id = value(row.character_id);
      depths.set(id, (depths.get(id) || 0) + Number(row.event_count || 0));
    }
    const maxDepth = Math.max(0, ...depths.values());
    const has = (...names: string[]) =>
      names.some((name) => eventNames.has(name));
    const shown = has('sub_show', 'purchase_page_view');
    const clicked = has('sub_click', 'pur_click');
    const success = has('sub_success', 'pur_succ');
    const identities = new Map<string, BiRawRow>();
    for (const row of attribution.get(`${user.bundle}:${user.userId}`) || []) {
      if (user.platform === 'ios' && Number(row.platform) !== 2) continue;
      const key = JSON.stringify([
        value(row.channel).toLowerCase(),
        value(row.creative),
        value(row.adgroup),
        value(row.campaign),
      ]);
      identities.set(key, row);
    }
    const attributed =
      identities.size === 1 ? [...identities.values()][0] : undefined;
    const state =
      input.attribution === null
        ? 'unavailable'
        : identities.size > 1
          ? 'ambiguous'
          : attributed
            ? 'matched'
            : 'unattributed';
    const channel = attributed ? value(attributed.channel).toLowerCase() : '';
    const creative =
      user.platform === 'ios'
        ? iosCreative(attributed?.creative)
        : {
            name: attributed ? value(attributed.adgroup) : '',
            id: attributed ? value(attributed.creative) : '',
          };
    const creativeName = creative.name;
    const creativeId = creative.id;
    const campaignName = attributed ? value(attributed.campaign) : '';
    const key = JSON.stringify([
      user.date,
      user.platform,
      user.country,
      state,
      channel,
      creativeId,
      creativeName,
      campaignName,
    ]);
    const item =
      result.get(key) ||
      ({
        key,
        date: user.date,
        platform: user.platform,
        country: user.country,
        channel,
        attribution: state,
        creativeName,
        creativeId,
        campaignName,
        tags: parseCreativeTags(creativeName),
        users: 0,
        chat: 0,
        chat5: 0,
        chat20: 0,
        payShow: 0,
        payClick: 0,
        paySuccess: 0,
        successAny: 0,
        orders: 0,
      } satisfies CreativeFunnelRow);
    const counts = {
      chat:
        input.events === null
          ? null
          : Number(has('chat_page_send_message_success')),
      chat5:
        input.events === null || (unknownDepth && maxDepth < 5)
          ? null
          : Number(maxDepth >= 5),
      chat20:
        input.events === null || (unknownDepth && maxDepth < 20)
          ? null
          : Number(maxDepth >= 20),
      payShow: input.events === null ? null : Number(shown),
      payClick: input.events === null ? null : Number(shown && clicked),
      paySuccess:
        input.events === null ? null : Number(shown && clicked && success),
      successAny: input.events === null ? null : Number(success),
      orders:
        input.orders === null
          ? null
          : Number(orders.has(`${user.bundle}:${user.userId}:${user.date}`)),
    };
    item.users++;
    for (const field of Object.keys(counts) as (keyof typeof counts)[]) {
      item[field] =
        item[field] === null || counts[field] === null
          ? null
          : item[field]! + counts[field]!;
    }
    result.set(key, item);
  }
  return [...result.values()];
}
