/** Meta/Doris authorization failure must not sign the user out of the center. */
export function isCenterSessionError(
  status: number | undefined,
  payload: unknown,
): boolean {
  const message =
    payload && typeof payload === 'object' && 'message' in payload
      ? payload.message
      : undefined;
  return (
    (status === 401 && message === '请重新登录') ||
    (status === 409 && message === '登录身份已变化，请刷新页面后重试')
  );
}
