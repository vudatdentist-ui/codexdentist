"use client";

import { parseMoneyText } from "@/shared/money";
import { useEffect, useMemo, useRef, useState } from "react";

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
  const editing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (controlledValue == null || editing.current) return;

    const nextRawValue = toCanonicalMoney(controlledValue);
    setRawValue(nextRawValue);
    setDisplayValue(formatMoney(nextRawValue));
    inputRef.current?.setCustomValidity("");
  }, [controlledValue]);

  return (
    <>
      <input name={name} type="hidden" value={rawValue} readOnly />
      <input
        ref={inputRef}
        className={className}
        aria-label={ariaLabel}
        disabled={disabled}
        id={id}
        inputMode="decimal"
        onFocus={() => {
          editing.current = true;
          if (rawValue) setDisplayValue(rawValue);
        }}
        onBlur={() => {
          editing.current = false;
          if (rawValue) setDisplayValue(formatMoney(rawValue));
        }}
        onChange={(event) => {
          const typedValue = event.target.value;
          const partialSuffix = isPartialSuffixInput(typedValue);
          const parsed = partialSuffix ? null : parseMoneyText(typedValue);
          const nextRawValue = parsed == null ? "" : String(parsed);

          setRawValue(nextRawValue);
          // Keep the user's text/caret while editing. Inserting grouping marks
          // on every keypress makes the next digit invalidate the grouping.
          setDisplayValue(typedValue);
          event.currentTarget.setCustomValidity(
            typedValue.trim() && parsed == null
              ? document.documentElement.lang === "en"
                ? "Enter a valid amount."
                : "Nhập số tiền hợp lệ."
              : "",
          );
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
