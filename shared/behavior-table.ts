export interface BehaviorCount {
  users: number;
  events: number;
}
export const BEHAVIOR_LABELS: Record<string, string> = {
  first_open: '首次打开',
  chat_page_view_page: '进入聊天页',
  chat_page_send_message_success: '成功发送消息',
  sub_show: '查看订阅展示',
  sub_click: '点击订阅',
  sub_success: '订阅成功',
  pur_succ: '成功购买金币',
  chat_page_send_message_failed: '发送消息失败',
  app_remove: '出现卸载事件',
};
export const BEHAVIOR_ORDER = Object.keys(BEHAVIOR_LABELS);
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
