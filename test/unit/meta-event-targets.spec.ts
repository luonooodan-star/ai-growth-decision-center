import { paidCampaignTargets } from '@client/pages/growth-decision/paid-growth-display';
import { execFileSync } from 'node:child_process';
import { adsetEvent, metaTargets } from '@shared/meta-targets';
import type { MetaAdEntity } from '@shared/api.interface';

const entity: MetaAdEntity = {
  accountId: '123',
  id: '456',
  campaignId: '789',
  level: 'adset',
  name: 'arppu_middle_not_evidence',
  fetchedAt: '2026-09-21T00:00:00Z',
};
describe('adset event targets', () => {
  it('uses explicit install optimization and standard events, never the entity name', () => {
    expect(adsetEvent(entity)).toBeUndefined();
    expect(adsetEvent({ ...entity, optimizationGoal: 'APP_INSTALLS' })).toBe(
      'install',
    );
    expect(adsetEvent({ ...entity, conversionEvent: 'PURCHASE' })).toBe(
      'purchase',
    );
    expect(adsetEvent({ ...entity, conversionEvent: 'OTHER' })).toBeUndefined();
    expect(
      adsetEvent({ ...entity, level: 'campaign', conversionEvent: 'PURCHASE' }),
    ).toBeUndefined();
  });
  it('retains independent event targets within the same campaign', () => {
    expect(
      metaTargets([
        { ...entity, optimizationGoal: 'APP_INSTALLS' },
        { ...entity, id: '457', conversionEvent: 'Arppu_middle' },
        { ...entity, id: '458', conversionEvent: 'PURCHASE' },
      ]).conversionEvents,
    ).toEqual(['Arppu_middle', 'install', 'purchase']);
  });
  it('normalizes raw promoted objects without reducing custom events to OTHER', () => {
    const script = `import {normalizeMetaLogs} from './scripts/company-mac/normalize-meta-operations.mjs';
      const raw = { adset: [
        {id:'456',campaign_id:'789',promoted_object:{custom_event_type:'OTHER',custom_event_str:'Arppu_middle'}},
        {id:'457',campaign_id:'789',optimization_goal:'APP_INSTALLS'},
        {id:'458',campaign_id:'789',promoted_object:{custom_conversion_id:'999'}},
        {id:'459',campaign_id:'789',promoted_object:{custom_event_type:'OTHER'}}
      ]};
      process.stdout.write(JSON.stringify(normalizeMetaLogs('123','Asia/Shanghai',[],raw).entities));`;
    const result: MetaAdEntity[] = JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
      }),
    );
    expect(result.map((e) => e.conversionEvent)).toEqual([
      'Arppu_middle',
      'install',
      'custom_conversion:999',
      'OTHER',
    ]);
    expect(metaTargets(result).conversionEvents).not.toContain('OTHER');
    expect(metaTargets([result[3]]).eventStatus).toBe('pending');
  });
});

describe('paid campaign target index', () => {
  it('only joins requested campaigns with a single known account', () => {
    const entities = [
      { ...entity, campaignId: 'a', optimizationGoal: 'APP_INSTALLS' },
      { ...entity, campaignId: 'b', conversionEvent: 'PURCHASE' },
      { ...entity, campaignId: 'a', conversionEvent: 'PURCHASE' },
      {
        ...entity,
        campaignId: 'b',
        accountId: 'other',
        conversionEvent: 'OTHER',
      },
      { ...entity, campaignId: 'c', optimizationGoal: 'APP_INSTALLS' },
    ];
    entities.push({
      ...entity,
      campaignId: 'missing_account',
      accountId: '',
      optimizationGoal: 'APP_INSTALLS',
    });
    const targets = paidCampaignTargets(
      new Set(['b', 'a', 'no_meta', 'missing_account']),
      entities,
    );
    expect([...targets.keys()]).toEqual(['a']);
    expect(targets.get('a')?.metaConversionEvents).toEqual([
      'install',
      'purchase',
    ]);
  });
});
