export function facebookBalanceSource(username: string) {
  return username === 'jsa' || username === 'fjx' ? 'growth' : username;
}

// Account names include a product token followed by its platform, e.g. XX-Mellow-andr-01.
export function facebookBalanceProduct(name: string) {
  const match =
    /(?:^|[^a-z0-9])([a-z0-9]+)[-_\s]+(ios|android|andr|and)(?=$|[^a-z0-9])/i.exec(
      name,
    );
  return match
    ? match[1].toLowerCase() +
        (match[2].toLowerCase() === 'ios' ? ' iOS' : ' 安卓')
    : '';
}
