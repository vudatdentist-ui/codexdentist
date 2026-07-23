import type { ReactNode } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

export function ConfirmDialog({
  cancelLabel,
  children,
  confirmLabel,
  onCancel,
  onConfirm,
  title,
}: {
  cancelLabel: string;
  children: ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <Modal labelledBy="confirm-dialog-title">
      <div className="progress-modal-header">
        <h3 id="confirm-dialog-title">{title}</h3>
      </div>
      <div className="progress-modal-body">{children}</div>
      <div className="progress-modal-actions">
        <Button onClick={onCancel} type="button" variant="secondary">
          {cancelLabel}
        </Button>
        <Button onClick={onConfirm} type="button" variant="danger">
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

