"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import styles from "../shared.module.css";
import { cx } from "../utils";

export interface TabItem {
  disabled?: boolean;
  label: ReactNode;
  value: string;
}

export interface TabsProps {
  "aria-label": string;
  items: TabItem[];
  onValueChange: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  value: string;
}

export function Tabs({
  items,
  onValueChange,
  orientation = "horizontal",
  value,
  ...props
}: TabsProps) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusValue, setFocusValue] = useState<string | null>(() => {
    const selectedItem = items.find(
      (item) => item.value === value && !item.disabled,
    );
    return selectedItem?.value ?? items.find((item) => !item.disabled)?.value ?? null;
  });

  useEffect(() => {
    setFocusValue((current) => {
      if (current && items.some((item) => item.value === current && !item.disabled)) {
        return current;
      }

      const selectedItem = items.find(
        (item) => item.value === value && !item.disabled,
      );
      return selectedItem?.value ?? items.find((item) => !item.disabled)?.value ?? null;
    });
  }, [items, value]);

  const moveFocus = (
    currentValue: string,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    const enabledItems = items.filter((item) => !item.disabled);
    if (enabledItems.length === 0) return;

    const currentIndex = enabledItems.findIndex(
      (item) => item.value === currentValue,
    );
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % enabledItems.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex =
          (currentIndex - 1 + enabledItems.length) % enabledItems.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = enabledItems.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextValue = enabledItems[nextIndex].value;
    setFocusValue(nextValue);
    tabRefs.current.get(nextValue)?.focus();
  };

  return (
    <div
      aria-label={props["aria-label"]}
      aria-orientation={orientation}
      className={cx(
        styles.tabs,
        orientation === "vertical" && styles.tabsVertical,
      )}
      role="tablist"
    >
      {items.map((item) => (
        <button
          aria-selected={item.value === value}
          className={cx(
            styles.tab,
            item.value === value && styles.tabActive,
          )}
          disabled={item.disabled}
          key={item.value}
          onClick={() => {
            setFocusValue(item.value);
            onValueChange(item.value);
          }}
          onKeyDown={(event) => moveFocus(item.value, event)}
          ref={(node) => {
            if (node) {
              tabRefs.current.set(item.value, node);
            } else {
              tabRefs.current.delete(item.value);
            }
          }}
          role="tab"
          tabIndex={!item.disabled && item.value === focusValue ? 0 : -1}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
