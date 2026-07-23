import type { ChangeEventHandler, ReactNode } from "react";
import { Search } from "lucide-react";

export function SearchCombobox({
  children,
  label,
  onChange,
  placeholder,
  value,
}: {
  children?: ReactNode;
  label: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="search-combobox">
      <span>{label}</span>
      <div>
        <Search size={16} aria-hidden="true" />
        <input onChange={onChange} placeholder={placeholder} type="search" value={value} />
      </div>
      {children}
    </label>
  );
}

