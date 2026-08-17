import { registerDecorator, ValidationOptions } from 'class-validator';

export function isValidIranNationalCode(value: string): boolean {
  const code = String(value ?? '').trim();
  if (!/^\d{10}$/.test(code)) return false;
  if (/^(\d)\1{9}$/.test(code)) return false;
  const check = Number(code[9]);
  const sum = code
    .slice(0, 9)
    .split('')
    .reduce((acc, digit, index) => acc + Number(digit) * (10 - index), 0);
  const remainder = sum % 11;
  return remainder < 2 ? check === remainder : check === 11 - remainder;
}

export function isValidIranIban(value: string): boolean {
  const raw = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  if (!raw) return false;
  const iban = raw.startsWith('IR') ? raw : `IR${raw}`;
  if (!/^IR\d{24}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, (ch) =>
    String(ch.charCodeAt(0) - 55),
  );
  let remainder = 0;
  for (const ch of expanded) {
    remainder = (remainder * 10 + Number(ch)) % 97;
  }
  return remainder === 1;
}

export function IsIranNationalCode(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isIranNationalCode',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidIranNationalCode(value);
        },
        defaultMessage() {
          return 'کد ملی نامعتبر است';
        },
      },
    });
  };
}

export function IsIranIban(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isIranIban',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value == null || value === '') return true;
          return typeof value === 'string' && isValidIranIban(value);
        },
        defaultMessage() {
          return 'شماره شبا نامعتبر است';
        },
      },
    });
  };
}
