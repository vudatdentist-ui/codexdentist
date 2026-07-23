import { Sparkles } from "lucide-react";
import { Button } from "./Button";

export function AiModuleButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button onClick={onClick} type="button" variant="secondary">
      <Sparkles size={16} aria-hidden="true" />
      {label}
    </Button>
  );
}

