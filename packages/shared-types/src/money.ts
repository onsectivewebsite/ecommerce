export type CurrencyCode =
  | 'USD'
  | 'INR'
  | 'CAD'
  | 'JPY'
  | 'CNY'
  | 'PKR'
  | 'BDT'
  | 'VND'
  | 'GBP'
  | 'AUD'
  | 'RUB'
  | 'EUR';

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

const MINOR_UNIT_EXPONENT: Record<CurrencyCode, number> = {
  USD: 2,
  INR: 2,
  CAD: 2,
  JPY: 0,
  CNY: 2,
  PKR: 2,
  BDT: 2,
  VND: 0,
  GBP: 2,
  AUD: 2,
  RUB: 2,
  EUR: 2,
};

export function exponentFor(currency: CurrencyCode): number {
  return MINOR_UNIT_EXPONENT[currency];
}

export function toMajor(money: Money): number {
  const exp = exponentFor(money.currency);
  return money.amountMinor / 10 ** exp;
}

export function fromMajor(amountMajor: number, currency: CurrencyCode): Money {
  const exp = exponentFor(currency);
  return { amountMinor: Math.round(amountMajor * 10 ** exp), currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add ${a.currency} and ${b.currency}`);
  }
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function multiplyMoney(m: Money, factor: number): Money {
  return { amountMinor: Math.round(m.amountMinor * factor), currency: m.currency };
}

export function formatMoney(money: Money, locale: string = 'en-US'): string {
  const value = toMajor(money);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: exponentFor(money.currency),
    maximumFractionDigits: exponentFor(money.currency),
  }).format(value);
}

export function formatMinor(
  amountMinor: number,
  currency: CurrencyCode,
  locale: string = 'en-US',
): string {
  return formatMoney({ amountMinor, currency }, locale);
}
