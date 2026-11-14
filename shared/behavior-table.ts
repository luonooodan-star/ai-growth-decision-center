export interface BehaviorCount {
  users: number;
  events: number;
}
// Empty lists deliberately mean "mapping not yet confirmed", never zero events.
export const KEY_BEHAVIOR_EVENTS: Record<
  string,
  { label: string; events: string[] }
> = {
  first_open: { label: '首次打开', events: ['first_open'] },
  initial_setup: { label: '完成首次设置', events: [] },
  chat_page_view_page: { label: '进入聊天页', events: ['chat_page_view_page'] },
  chat_page_send_message_success: {
    label: '成功发送消息',
    events: ['chat_page_send_message_success'],
  },
  message_10_milestone: {
    label: '触发 10 条消息里程碑',
    events: ['message_10'],
  },
  message_20_milestone: {
    label: '触发 20 条消息里程碑',
    events: ['message_20'],
  },
  message_30_milestone: { label: '触发 30 条消息里程碑', events: [] },
  sub_show: { label: '查看订阅展示', events: ['sub_show'] },
  sub_click: { label: '点击订阅', events: ['sub_click'] },
  pur_succ: { label: '成功购买金币', events: ['pur_succ'] },
  chat_page_send_message_failed: {
    label: '发送消息失败',
    events: ['chat_page_send_message_failed'],
  },
  app_remove: { label: '出现卸载事件', events: ['app_remove'] },
};
export const KEY_BEHAVIOR_EVENT_MAP = Object.fromEntries(
  Object.entries(KEY_BEHAVIOR_EVENTS).map(([id, item]) => [id, item.events]),
) as Record<string, string[]>;
export const BEHAVIOR_ORDER = Object.keys(KEY_BEHAVIOR_EVENTS);
export const BEHAVIOR_LABELS = Object.fromEntries(
  Object.entries(KEY_BEHAVIOR_EVENTS).map(([id, item]) => [id, item.label]),
) as Record<string, string>;
export const isKeyBehavior = (event: unknown): event is string =>
  typeof event === 'string' &&
  Object.prototype.hasOwnProperty.call(KEY_BEHAVIOR_EVENTS, event);
export function keyBehaviorEventNames(event?: string): string[] {
  return [
    ...new Set(
      (event && isKeyBehavior(event)
        ? [KEY_BEHAVIOR_EVENTS[event]]
        : event
          ? []
          : Object.values(KEY_BEHAVIOR_EVENTS)
      ).flatMap((item) => item.events),
    ),
  ];
}
export function mergeBehaviorCounts(
  rows: { behaviors?: Record<string, BehaviorCount> }[],
): Record<string, BehaviorCount> | null {
  if (rows.some((r) => !r.behaviors)) return null;
  const result: Record<string, BehaviorCount> = {};
  for (const row of rows)
    for (const [event, c] of Object.entries(row.behaviors || {})) {
      const before = result[event] || { users: 0, events: 0 };
      result[event] = {
        users: before.users + c.users,
        events: before.events + c.events,
      };
    }
  return result;
}
