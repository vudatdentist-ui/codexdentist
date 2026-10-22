export function displayMedicationName(medication: {
  genericName: string;
  brandName: string | null;
  strength: string | null;
}) {
  const strength = medication.strength ? ` ${medication.strength}` : "";
  const genericName = medication.genericName.trim();
  const brandName = medication.brandName?.trim();
  const isCombination = /[+/]|clavulanic|clavulanate|phối hợp/i.test(genericName);

  if (brandName && isCombination) {
    return `${brandName}${strength}`;
  }

  if (brandName) {
    return `${genericName}${strength} (${brandName})`;
  }

  return `${genericName}${strength}`;
}
