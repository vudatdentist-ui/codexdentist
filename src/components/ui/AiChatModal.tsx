import type { ReactNode } from "react";
import { Modal } from "./Modal";

export function AiChatModal({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <Modal labelledBy="ai-chat-modal-title">
      <div className="progress-modal-header">
        <h3 id="ai-chat-modal-title">{title}</h3>
      </div>
      {children}
    </Modal>
  );
}

