import { useLayoutEffect, useRef } from "react";
import type { RosterEntry } from "./protocol";

type Props = {
  candidates: RosterEntry[];
  highlightedId: number;
  onPick: (entry: RosterEntry) => void;
  container: HTMLElement | null;
};

export function MentionList({ candidates, highlightedId, onPick, container }: Props) {
  const boxRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !container) return;
    box.style.left = "0px";
    const overflow = box.getBoundingClientRect().right - container.getBoundingClientRect().right + 8;
    if (overflow > 0) box.style.left = `${-overflow}px`;
  });

  return (
    <span className="mention-anchor">
      <span ref={boxRef} className="mention-list" role="listbox" aria-label="Handle suggestions">
        {candidates.map((entry) => {
          const highlighted = entry.participantId === highlightedId;
          return (
            <span
              key={entry.participantId}
              role="option"
              aria-selected={highlighted}
              className={`mention-option${highlighted ? " highlighted" : ""}`}
              style={{ color: entry.color }}
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(entry);
              }}
            >
              {entry.handle}
            </span>
          );
        })}
      </span>
    </span>
  );
}
