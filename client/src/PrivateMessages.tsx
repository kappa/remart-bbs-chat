import { useEffect, useRef } from "react";

export const PRIVATE_TIMEOUT_MS = 15000;
export type PrivateMessage = { id: number; from: number; handle: string; color: string; text: string; receivedAt: number };
type Props = { messages: PrivateMessage[]; onDismiss: (id: number) => void };

// Ephemeral private traffic stays in this overlay and never enters room state.
export function PrivateMessages({ messages, onDismiss }: Props) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const oldest = messages[0];
  const oldestId = oldest?.id;
  const oldestAt = oldest?.receivedAt;
  useEffect(() => {
    if (oldestId == null || oldestAt == null) return;
    const delay = Math.max(0, oldestAt + PRIVATE_TIMEOUT_MS - Date.now());
    const timer = window.setTimeout(() => onDismissRef.current(oldestId), delay);
    return () => window.clearTimeout(timer);
  }, [oldestId, oldestAt]);
  if (!messages.length) return null;
  return (
    <div className="private-stack" aria-live="polite">
      {messages.map((message) => (
        <div key={message.id} className="private-popup" role="status" onClick={() => onDismiss(message.id)}>
          <div className="private-from" style={{ color: message.color }}>{message.handle}</div>
          <div className="private-text">{message.text}</div>
        </div>
      ))}
    </div>
  );
}
