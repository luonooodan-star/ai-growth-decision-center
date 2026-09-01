import {
  dorisNumber,
  dorisString,
  normalizeDorisQueryResult,
  parseMcpHttpPayload,
  type DorisQueryResult,
  type DorisRow,
} from '../../server/modules/growth-decision/doris-result-normalizer';

describe('Doris result normalizer', () => {
  it('reads spend aliases and formatted numeric values', () => {
    const row: DorisRow = {
      'SUM(spend)': '$1,234.56',
      adset_id: 'adset-1',
      'AVG(d0_roas)': '12.5%',
    };

    expect(dorisNumber(row, 'spend')).toBe(1234.56);
    expect(dorisNumber(row, 'd0_roas')).toBe(0.125);
    expect(dorisString(row, 'adgroup_id')).toBe('adset-1');
  });

  it('normalizes nested MCP query results', () => {
    const result: DorisQueryResult = normalizeDorisQueryResult({
      result: {
        data: {
          rowCount: 1,
          rows: [{ amount_spent: 88.2, campaign_id: 'campaign-1' }],
        },
      },
    });

    expect(result.row_count).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(dorisNumber(result.rows?.[0] || {}, 'spend')).toBe(88.2);
  });

  it('parses JSON embedded in an MCP text response', () => {
    const result: DorisQueryResult = normalizeDorisQueryResult(
      'query ok\n{"rows":[{"cost":"9.50"}]}',
    );

    expect(result.row_count).toBe(1);
    expect(dorisNumber(result.rows?.[0] || {}, 'spend')).toBe(9.5);
  });

  it('parses the JSON string returned in structuredContent.result', () => {
    const result: DorisQueryResult = normalizeDorisQueryResult({
      result: JSON.stringify({
        row_count: 2,
        rows: [
          { report_date: '2026-08-27', spend: '18.50' },
          { report_date: '2026-08-28', spend: '21.75' },
        ],
      }),
    });

    expect(result.row_count).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(dorisNumber(result.rows?.[1] || {}, 'spend')).toBe(21.75);
  });

  it('parses a Markdown table returned by Doris MCP', () => {
    const result: DorisQueryResult = normalizeDorisQueryResult(`
Query completed.
| report_date | campaign_name | spend | impressions |
| --- | --- | ---: | ---: |
| 2026-09-01 | campaign-a | 12.50 | 1000 |
| 2026-09-01 | campaign-b | 7.25 | 800 |
`);

    expect(result.row_count).toBe(2);
    expect(result.rows?.[0]?.campaign_name).toBe('campaign-a');
    expect(dorisNumber(result.rows?.[1] || {}, 'spend')).toBe(7.25);
  });

  it('parses fenced JSON and multi-event SSE responses', () => {
    const fenced: DorisQueryResult = normalizeDorisQueryResult(
      '```json\n{"rows":[{"spend":3.5}]}\n```',
    );
    const payload: unknown = parseMcpHttpPayload(
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\ndata: [DONE]\n',
      'text/event-stream',
    );

    expect(dorisNumber(fenced.rows?.[0] || {}, 'spend')).toBe(3.5);
    expect(payload).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    });
  });

  it('accepts a root JSON array of Doris rows', () => {
    const result: DorisQueryResult = normalizeDorisQueryResult(
      '[{"campaign_id":"campaign-1","spend":6.25}]',
    );

    expect(result.row_count).toBe(1);
    expect(result.rows?.[0]?.campaign_id).toBe('campaign-1');
  });

  it('preserves the Doris text error for troubleshooting', () => {
    expect(() =>
      normalizeDorisQueryResult('Unknown metric: placement'),
    ).toThrow('Doris MCP 查询失败：Unknown metric: placement');
  });
});
