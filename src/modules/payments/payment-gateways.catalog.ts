/** Catalog + JSON shape for multi-gateway admin/runtime config. */

export type PaymentGatewayName = 'zibal';

export type PaymentGatewayConfigItem = {
  id: string;
  type: PaymentGatewayName;
  label: string;
  enabled: boolean;
  sortOrder: number;
};

export type PaymentGatewayCatalogField = {
  secretKey: string;
  label: string;
  kind: 'secret' | 'text' | 'url';
  required?: boolean;
  placeholder?: string;
};

export type PaymentGatewayCatalogEntry = {
  type: PaymentGatewayName;
  label: string;
  defaultLabel: string;
  hosts: string[];
  fields: PaymentGatewayCatalogField[];
};

export const PAYMENT_GATEWAY_CATALOG: PaymentGatewayCatalogEntry[] = [
  {
    type: 'zibal',
    label: 'زیبال',
    defaultLabel: 'زیبال',
    hosts: ['gateway.zibal.ir'],
    fields: [
      {
        secretKey: 'ZIBAL_MERCHANT',
        label: 'Merchant / توکن زیبال',
        kind: 'secret',
        required: true,
        placeholder: 'zibal',
      },
      {
        secretKey: 'ZIBAL_REQUEST_URL',
        label: 'URL درخواست',
        kind: 'url',
        placeholder: 'https://gateway.zibal.ir/v1/request',
      },
      {
        secretKey: 'ZIBAL_VERIFY_URL',
        label: 'URL تأیید',
        kind: 'url',
        placeholder: 'https://gateway.zibal.ir/v1/verify',
      },
      {
        secretKey: 'ZIBAL_START_PAY_URL',
        label: 'URL شروع پرداخت',
        kind: 'url',
        placeholder: 'https://gateway.zibal.ir/start',
      },
      {
        secretKey: 'ZIBAL_CALLBACK_URL',
        label: 'Callback (اختیاری)',
        kind: 'url',
        placeholder: 'https://api.example.com/api/v1/payments/callback/zibal',
      },
    ],
  },
];

const CATALOG_BY_TYPE = new Map(
  PAYMENT_GATEWAY_CATALOG.map((e) => [e.type, e] as const),
);

export function isKnownPaymentGatewayType(
  value: string,
): value is PaymentGatewayName {
  return CATALOG_BY_TYPE.has(value as PaymentGatewayName);
}

export function getPaymentGatewayCatalogEntry(
  type: string,
): PaymentGatewayCatalogEntry | undefined {
  return CATALOG_BY_TYPE.get(type as PaymentGatewayName);
}

export function parsePaymentGatewaysJson(
  raw: string | null | undefined,
): PaymentGatewayConfigItem[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seenTypes = new Set<string>();
  const items: PaymentGatewayConfigItem[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    if (!row || typeof row !== 'object') continue;
    const typeRaw = String((row as { type?: unknown }).type ?? '')
      .trim()
      .toLowerCase();
    if (!isKnownPaymentGatewayType(typeRaw)) continue;
    if (seenTypes.has(typeRaw)) continue;
    seenTypes.add(typeRaw);

    const catalog = getPaymentGatewayCatalogEntry(typeRaw)!;
    const idRaw = String((row as { id?: unknown }).id ?? '').trim();
    const id = idRaw || typeRaw;
    const labelRaw = String((row as { label?: unknown }).label ?? '').trim();
    const enabled = (row as { enabled?: unknown }).enabled === true;
    const sortRaw = Number((row as { sortOrder?: unknown }).sortOrder);
    const sortOrder = Number.isFinite(sortRaw) ? sortRaw : i;

    items.push({
      id,
      type: typeRaw,
      label: labelRaw || catalog.defaultLabel,
      enabled,
      sortOrder,
    });
  }

  items.sort((a, b) => a.sortOrder - b.sortOrder || a.type.localeCompare(b.type));
  return items;
}

export function serializePaymentGatewaysJson(
  items: PaymentGatewayConfigItem[],
): string {
  return JSON.stringify(items);
}

export function validatePaymentGatewaysJson(raw: string): void {
  if (!raw.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PAYMENT_GATEWAYS_JSON نامعتبر است');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('PAYMENT_GATEWAYS_JSON باید آرایه باشد');
  }
  const seen = new Set<string>();
  for (const row of parsed) {
    if (!row || typeof row !== 'object') {
      throw new Error('هر آیتم درگاه باید آبجکت باشد');
    }
    const typeRaw = String((row as { type?: unknown }).type ?? '')
      .trim()
      .toLowerCase();
    if (!isKnownPaymentGatewayType(typeRaw)) {
      throw new Error(`نوع درگاه پشتیبانی نمی‌شود: ${typeRaw || '(خالی)'}`);
    }
    if (seen.has(typeRaw)) {
      throw new Error(`درگاه تکراری: ${typeRaw}`);
    }
    seen.add(typeRaw);
  }
}
