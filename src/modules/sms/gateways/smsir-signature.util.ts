import { createHmac } from 'crypto';

export const SMS_IR_BASE_URL = 'https://api.sms.ir/v1';
export const SMS_IR_PLUGIN_STATIC = 'SMS.irPlugin:VaKUsW8XZ4!OEoU7jX?a';

export function buildSmsIrSignedHeaders(
  apiKey: string,
  timestamp?: number,
): Record<string, string> {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signatureString = `${apiKey}:${ts}:${SMS_IR_PLUGIN_STATIC}`;
  const signature = createHmac('sha256', apiKey)
    .update(signatureString)
    .digest('base64');

  return {
    'X-API-KEY': apiKey,
    'X-TIMESTAMP': String(ts),
    'X-SIGNATURE': signature,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}
