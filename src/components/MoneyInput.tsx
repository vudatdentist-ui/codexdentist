"use client";

import { useEffect, useMemo, useState } from "react";

type MoneyInputProps = {
  name: string;
  defaultValue?: number | string | null;
  value?: number | string | null;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
  onValueChange?: (value: string) => void;
};

export function MoneyInput({
  className,
  defaultValue,
  disabled,
  id,
  name,
  onValueChange,
  placeholder,
  required,
  value,
  "aria-label": ariaLabel,
}: MoneyInputProps) {
  const controlledValue = value == null ? null : String(value);
  const initialValue = useMemo(
    () => toCanonicalMoney(controlledValue ?? defaultValue),
    [controlledValue, defaultValue],
  );
  const [rawValue, setRawValue] = useState(initialValue);
  const [displayValue, setDisplayValue] = useState(formatMoney(initialValue));

  useEffect(() => {
    if (controlledValue == null) return;

    const nextRawValue = toCanonicalMoney(controlledValue);
    setRawValue(nextRawValue);
    setDisplayValue(formatMoney(nextRawValue));
  }, [controlledValue]);

  return (
    <>
      <input name={name} type="hidden" value={rawValue} readOnly />
      <input
        className={className}
        aria-label={ariaLabel}
        disabled={disabled}
        id={id}
        inputMode="decimal"
        onChange={(event) => {
          const typedValue = event.target.value;
          const partialSuffix = isPartialSuffixInput(typedValue);
          const parsed = partialSuffix ? null : parseMoneyText(typedValue);
          const nextRawValue = parsed == null ? "" : String(parsed);

          setRawValue(nextRawValue);
          setDisplayValue(partialSuffix ? typedValue : formatMoney(nextRawValue));
          if (!partialSuffix) {
            onValueChange?.(nextRawValue);
          }
        }}
        placeholder={placeholder ?? "5.000.000"}
        required={required}
        type="text"
        value={displayValue}
      />
    </>
  );
}

function toCanonicalMoney(value: number | string | null | undefined) {
  const parsed = parseMoneyText(String(value ?? ""));

  return parsed == null ? "" : String(parsed);
}

function parseMoneyText(value: string) {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/₫|vnd|đ/g, "");

  if (!cleaned) return null;

  const suffixMatch = cleaned.match(/^(.*?)(k|nghin|ngan|ngàn|m|tr|trieu|triệu|ty|tỷ)$/u);

  if (suffixMatch) {
    const numericPart = suffixMatch[1].replace(/,/g, ".");
    const numericValue = Number(numericPart.replace(/[^0-9.]/g, ""));

    if (!Number.isFinite(numericValue)) return null;

    const suffix = suffixMatch[2];
    const multiplier =
      suffix === "k" || suffix === "nghin" || suffix === "ngan" || suffix === "ngàn"
        ? 1_000
        : suffix === "ty" || suffix === "tỷ"
          ? 1_000_000_000
          : 1_000_000;

    return Math.round(numericValue * multiplier);
  }

  const digits = cleaned.replace(/\D/g, "");
  const amount = Number(digits);

  return digits && Number.isFinite(amount) ? amount : null;
}

function isPartialSuffixInput(value: string) {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/₫|vnd|đ/g, "");
  const suffixMatch = cleaned.match(/^([\d.,]+)([a-zà-ỹ]+)$/u);

  if (!suffixMatch) return false;

  const suffix = suffixMatch[2];
  const fullSuffixes = ["k", "nghin", "ngan", "ngàn", "m", "tr", "trieu", "triệu", "ty", "tỷ"];

  if (fullSuffixes.includes(suffix)) return false;

  return fullSuffixes.some((fullSuffix) => fullSuffix.startsWith(suffix));
}

function formatMoney(value: string) {
  const amount = Number(value);

  if (!value || !Number.isFinite(amount)) return "";

  return new Intl.NumberFormat("vi-VN").format(amount);
}
