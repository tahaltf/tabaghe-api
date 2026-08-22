/** Iranian bank BIN (first 6 digits) → bank name (Persian). */
export const IRAN_BANK_NAMES_BY_BIN: Record<string, string> = {
  '627412': 'اقتصاد نوین',
  '627381': 'انصار',
  '505785': 'ایران زمین',
  '622106': 'پارسیان',
  '639194': 'پارسیان',
  '627884': 'پارسیان',
  '639347': 'پاسارگاد',
  '502229': 'پاسارگاد',
  '636214': 'آینده',
  '627353': 'تجارت',
  '585983': 'تجارت',
  '502908': 'توسعه تعاون',
  '627648': 'توسعه صادرات ایران',
  '207177': 'توسعه صادرات ایران',
  '636949': 'حکمت ایرانیان (سپه)',
  '585947': 'خاورمیانه',
  '502938': 'دی',
  '589463': 'رفاه کارگران',
  '621986': 'سامان',
  '589210': 'سپه',
  '639607': 'سرمایه',
  '639346': 'سینا',
  '502806': 'شهر',
  '504706': 'شهر',
  '603769': 'صادرات ایران',
  '627961': 'صنعت و معدن',
  '606373': 'قرض الحسنه مهر ایران',
  '504172': 'قرض الحسنه رسالت',
  '639599': 'قوامین',
  '627488': 'کارآفرین',
  '502910': 'کارآفرین',
  '603770': 'کشاورزی',
  '639217': 'کشاورزی',
  '505416': 'گردشگری',
  '636795': 'مرکزی',
  '628023': 'مسکن',
  '610433': 'ملت',
  '991975': 'ملت',
  '603799': 'ملی ایران',
  '639370': 'مهر اقتصاد (سپه)',
  '606256': 'موسسه اعتباری ملل',
  '627760': 'پست ایران',
  '628157': 'موسسه اعتباری توسعه',
  '505801': 'موسسه اعتباری کوثر (سپه)',
};

export function normalizeCardDigits(cardNumber: string): string {
  return String(cardNumber ?? '').replace(/\D/g, '');
}

export function resolveBankByCard(cardNumber: string): {
  bin: string;
  bankName: string | null;
} {
  const digits = normalizeCardDigits(cardNumber);
  if (digits.length < 6) {
    return { bin: digits.slice(0, 6), bankName: null };
  }
  const bin = digits.slice(0, 6);
  return { bin, bankName: IRAN_BANK_NAMES_BY_BIN[bin] ?? null };
}

export function formatMaskedCard(cardNumber: string): string {
  const digits = normalizeCardDigits(cardNumber);
  if (digits.length !== 16) return digits;
  return `${digits.slice(0, 4)} •••• •••• ${digits.slice(-4)}`;
}
