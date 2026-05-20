import React from 'react';
import { Text, type TextProps } from 'react-native';

interface Props extends TextProps {
  amountMinor: number;
  currency: string;
  emphasized?: boolean;
}

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP']);

export function Money({ amountMinor, currency, emphasized, style, ...rest }: Props) {
  const divisor = ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100;
  const value = amountMinor / divisor;
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2,
    }).format(value);
  } catch {
    formatted = `${value.toFixed(2)} ${currency.toUpperCase()}`;
  }
  return (
    <Text
      {...rest}
      style={[
        { color: '#f8f9fc', fontVariant: ['tabular-nums'] },
        emphasized && { fontWeight: '700', fontSize: 20 },
        style,
      ]}
    >
      {formatted}
    </Text>
  );
}
