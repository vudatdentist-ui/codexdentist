import type { ChangeEventHandler } from "react";

export function DateRangeFilter({
  fromLabel,
  fromName = "from",
  fromValue,
  onFromChange,
  onToChange,
  toLabel,
  toName = "to",
  toValue,
}: {
  fromLabel: string;
  fromName?: string;
  fromValue: string;
  onFromChange: ChangeEventHandler<HTMLInputElement>;
  onToChange: ChangeEventHandler<HTMLInputElement>;
  toLabel: string;
  toName?: string;
  toValue: string;
}) {
  return (
    <div className="date-range-filter">
      <label>
        {fromLabel}
        <input name={fromName} onChange={onFromChange} type="date" value={fromValue} />
      </label>
      <label>
        {toLabel}
        <input name={toName} onChange={onToChange} type="date" value={toValue} />
      </label>
    </div>
  );
}

