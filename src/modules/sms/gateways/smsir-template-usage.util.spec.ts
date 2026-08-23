import {
  buildSmsIrTemplateUsageMap,
} from './smsir-template-usage.util';

describe('buildSmsIrTemplateUsageMap', () => {
  it('counts site settings and notification rule references', () => {
    const result = buildSmsIrTemplateUsageMap({
      siteSettings: {
        SMS_OTP_TEMPLATE_ID: '591069',
        SMS_DEPLOY_ALERT_TEMPLATE_ID: '426808',
      },
      notificationRulesJson: JSON.stringify({
        'ORDER_CREATED@BUYER': {
          smsEnabled: true,
          smsTemplateConfig: { templateId: 591069 },
          batchSmsTemplateConfig: { templateId: 999001 },
        },
      }),
    });

    expect(result.totalReferences).toBe(4);
    expect(result.byTemplateId['591069'].count).toBe(2);
    expect(result.byTemplateId['591069'].locations).toHaveLength(2);
    expect(result.byTemplateId['426808'].count).toBe(1);
    expect(result.byTemplateId['999001'].count).toBe(1);
  });
});
