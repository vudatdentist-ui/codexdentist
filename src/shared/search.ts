
export function normalizeSearchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase().trim();
}

export function matchesChartSearch(query: string, values: Array<string | number | null | undefined>) {
    if (!query) {
        return true;
    }
    return values.some((value) => normalizeSearchText(value).includes(query));
}
