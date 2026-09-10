import { useEffect } from "react";
import type { PrivateIncoming } from "./useRoomConnection";

export const PRIVATE_TIMEOUT_MS = 15000;
// Only the newest few are kept; the oldest would time out first anyway.
export const PRIVATE_STACK_MAX = 5;
// receivedAt is performance.now(), so a wall-clock change cannot hold a popup.
export type PrivatePopup = PrivateIncoming & { id: number; receivedAt: number };
type Props = { messages: PrivatePopup[]; onDismiss: (id: number) => void };

// Ephemeral private traffic stays in this overlay and never enters room state.
// The stack is always on the page so screen readers announce the first arrival.
export function PrivateMessages({ messages, onDismiss }: Props) {
  const oldest = messages[0];
  const oldestId = oldest?.id;
  const oldestAt = oldest?.receivedAt;
  useEffect(() => {
    if (oldestId == null || oldestAt == null) return;
    const delay = Math.max(0, oldestAt + PRIVATE_TIMEOUT_MS - performance.now());
    const timer = window.setTimeout(() => onDismiss(oldestId), delay);
    return () => window.clearTimeout(timer);
  }, [oldestId, oldestAt, onDismiss]);
  return (
    <div className="private-stack" aria-live="polite">
      {messages.map((message) => (
        <button type="button" key={message.id} className="private-popup" onClick={() => onDismiss(message.id)}>
          <span className="private-from" style={{ color: message.color }}>{message.handle}</span>
          <span className="private-text">{message.text}</span>
        </button>
      ))}
    </div>
  );
}
