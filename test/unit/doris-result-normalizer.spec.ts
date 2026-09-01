import {
  dorisNumber,
  dorisString,
  normalizeDorisQueryResult,
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
});
