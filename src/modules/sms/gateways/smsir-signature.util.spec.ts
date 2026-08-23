import { createHmac } from 'crypto';
import {
  SMS_IR_PLUGIN_STATIC,
  buildSmsIrSignedHeaders,
} from './smsir-signature.util';

describe('buildSmsIrSignedHeaders', () => {
  it('matches PHP HMAC-SHA256 base64 output for a fixed timestamp', () => {
    const apiKey = 'test-api-key-12345';
    const timestamp = 1700000000;
    const signatureString = `${apiKey}:${timestamp}:${SMS_IR_PLUGIN_STATIC}`;
    const expected = createHmac('sha256', apiKey)
      .update(signatureString)
      .digest('base64');

    const headers = buildSmsIrSignedHeaders(apiKey, timestamp);

    expect(headers['X-API-KEY']).toBe(apiKey);
    expect(headers['X-TIMESTAMP']).toBe(String(timestamp));
    expect(headers['X-SIGNATURE']).toBe(expected);
    expect(headers['Accept']).toBe('application/json');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
