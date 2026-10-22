/** Parse non-negative whole VND amounts; suffixes may contain a decimal fraction. */
export function parseMoneyText(value: string): number | null {
  const text = value.trim().toLowerCase().replace(/\s+/g, "")
    .replace(/(?:₫|vnd|đ)$/, "");
  if (!text) return null;
  const suffix = text.match(/^(\d+(?:[.,]\d+)?)(k|nghin|ngan|ngàn|m|tr|trieu|triệu|ty|tỷ)$/u);
  let amount: number;
  if (suffix) {
    const multiplier = /^(k|nghin|ngan|ngàn)$/.test(suffix[2]) ? 1_000
      : /^(ty|tỷ)$/.test(suffix[2]) ? 1_000_000_000 : 1_000_000;
    amount = Number(suffix[1].replace(",", ".")) * multiplier;
  } else {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+)$/.test(text)) return null;
    amount = Number(text.replace(/[.,]/g, ""));
  }
  const rounded = Math.round(amount);
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : null;
}
