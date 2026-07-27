const spreadsheetFormulaPrefix = /^[=+\-@\t\r]/;

export function csvCell(value: string | number) {
  const text = String(value);
  const safeText = spreadsheetFormulaPrefix.test(text) ? `'${text}` : text;

  if (!/[",\r\n]/.test(safeText)) {
    return safeText;
  }

  return `"${safeText.replaceAll('"', '""')}"`;
}
