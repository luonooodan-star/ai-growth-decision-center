import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { setImmediate as yieldToIO } from 'node:timers/promises';
import {
  mergeBuyerChannelOptions,
  type BuyerChannelOption,
} from '@shared/buyer-channel-options';
import type { BiPart } from '@shared/paid-growth.interface';

/** Each store and its prepared statements belong to one personal database connection. */
export class BiCacheStore {
  private readonly readByKey: StatementSync;
  private readonly write: StatementSync;
  private readonly prune: StatementSync;
  private readonly channelKey: string;
  private channelSeed?: Promise<void>;

  constructor(
    private readonly database: DatabaseSync,
    private readonly scope: string,
  ) {
    this.readByKey = database.prepare(
      'SELECT payload FROM growth_bi_cache WHERE cache_key = ?',
    );
    this.write = database.prepare(
      'INSERT INTO growth_bi_cache(cache_key,payload) VALUES (?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload',
    );
    // Uses the growth_bi_cache_age expression index. Retain recent detailed
    // entries regardless of row count or payload size.
    this.prune = database.prepare(
      `DELETE FROM growth_bi_cache WHERE julianday(json_extract(payload, '$.updatedAt')) < julianday('now', '-90 days')`,
    );
    this.channelKey = scope + ':paid-buyer-channels:v1';
  }

  read(key: string): string | undefined {
    const row = this.readByKey.get(key);
    return row ? String(row.payload) : undefined;
  }

  save(key: string, payload: string, part?: BiPart): void {
    this.write.run(key, payload);
    if (
      key.startsWith(this.scope + ':') &&
      key.includes('bi_ads.ads_paid_acquisition_daily') &&
      this.canContainBuyer(key)
    ) {
      const previous = this.savedBuyerChannels();
      this.saveBuyerChannels(
        previous,
        this.mergeSourceChannels(previous, key, part ?? JSON.parse(payload)),
      );
    }
    this.prune.run();
  }

  async buyerChannels(): Promise<BuyerChannelOption[]> {
    const marker = this.channelKey + ':seeded';
    if (!this.read(marker)) {
      this.channelSeed ??= this.seedBuyerChannels(marker).finally(() => {
        this.channelSeed = undefined;
      });
      await this.channelSeed;
    }
    return mergeBuyerChannelOptions(this.savedBuyerChannels(), [], '');
  }

  private savedBuyerChannels(): BuyerChannelOption[] {
    const raw = this.read(this.channelKey);
    return raw ? JSON.parse(raw).rows || [] : [];
  }

  private mergeSourceChannels(
    previous: BuyerChannelOption[],
    key: string,
    data: BiPart,
  ): BuyerChannelOption[] {
    if (
      !['fresh', 'cached'].includes(data.state) ||
      !Array.isArray(data.rows) ||
      !data.rows.length
    )
      return previous;
    const date =
      key.match(/"end_date":"(\d{4}-\d{2}-\d{2})"/)?.[1] ||
      String(data.updatedAt || '').slice(0, 10);
    return mergeBuyerChannelOptions(previous, data.rows, date);
  }

  private saveBuyerChannels(
    previous: BuyerChannelOption[],
    rows: BuyerChannelOption[],
  ) {
    if (previous === rows || JSON.stringify(previous) === JSON.stringify(rows))
      return;
    this.write.run(
      this.channelKey,
      JSON.stringify({ rows, updatedAt: new Date().toISOString() }),
    );
  }

  // Query dimensions are serialized in the cache key. Legacy keys without a
  // dimension list must still be checked against their actual cached rows.
  private canContainBuyer(key: string) {
    return !key.includes('"dimensions":[') || key.includes('"buyer_alias"');
  }

  private async seedBuyerChannels(marker: string) {
    const prefix = this.scope + ':';
    const keys = this.database.prepare(
      `SELECT cache_key FROM growth_bi_cache
       WHERE cache_key > ? AND cache_key < ?
         AND instr(cache_key,'bi_ads.ads_paid_acquisition_daily') > 0
       ORDER BY cache_key LIMIT 32`,
    );
    // ':' and ';' are adjacent in SQLite's binary collation.
    const upper = this.scope + ';';
    let after = prefix;
    let found: BuyerChannelOption[] = [];
    for (;;) {
      await yieldToIO();
      // Read only indexed keys, without holding a SQLite cursor across yields.
      const batch = keys.all(after, upper);
      for (const { cache_key } of batch) {
        after = String(cache_key);
        if (!this.canContainBuyer(after)) continue;
        const payload = this.read(after);
        if (payload)
          found = this.mergeSourceChannels(found, after, JSON.parse(payload));
        await yieldToIO();
      }
      if (batch.length < 32) break;
    }
    // A paid-data request can add a new channel while a legacy cache is being
    // scanned. Merge with the latest saved index in the same event-loop turn.
    const latest = this.savedBuyerChannels();
    this.saveBuyerChannels(
      latest,
      mergeBuyerChannelOptions([...latest, ...found], [], ''),
    );
    this.write.run(
      marker,
      JSON.stringify({ updatedAt: new Date().toISOString() }),
    );
  }
}
