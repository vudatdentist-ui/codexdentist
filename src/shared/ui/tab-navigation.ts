export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count < 1) return null;
  switch (key) {
    case "ArrowRight": return (index + 1 + count) % count;
    case "ArrowLeft": return (index - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
