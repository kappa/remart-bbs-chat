import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type UIEvent,
} from "react";
import { api } from "./api";
import { computeDocumentLines, isValidChar } from "./documentLines";
import { splitLinks } from "./links";
import { MentionList } from "./MentionList";
import { mentionCandidates, mentionCompletion, mentionTokenBefore } from "./mentions";
import type { RosterEntry } from "./protocol";
import { sortedCommitted } from "./roomState";
import { useRoomConnection } from "./useRoomConnection";

type Session = {
  roomId: number;
  roomName: string;
  participantId: number;
  handle: string;
  token: string;
  joinedAt: number;
  historyFromRow: number;
};

const SESSION_KEY = "remart-bbs-chat.session";
const HANDLE_KEY = "remart-bbs-chat.handle";
const SOUND_KEY = "remart-bbs-chat.sound";
const BASE_TITLE = "Remart BBS Chat";
const TITLE_NOTICE_MS = 5000;
const TITLE_TICK_MS = 400;

// Arrow and position keys map one-to-one onto server caret keystrokes.
const MOVEMENT_KINDS = { ArrowLeft: "left", ArrowRight: "right", Home: "home", End: "end" } as const;

function playJoinSound() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "square";
    osc2.frequency.value = 1320;
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    gain2.gain.setValueAtTime(0, ctx.currentTime + 0.12);
    gain2.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.13);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
    osc2.start(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.4);
    setTimeout(() => { try { ctx.close(); } catch {} }, 600);
  } catch {
    // Audio blocked or unavailable — silent fail, chat remains usable
  }
}

/*
 * Desktop hosts may load the artifact in a third-party or privacy-restricted
 * iframe where Web Storage exists but throws a SecurityError when accessed.
 * Storage is only a convenience here, so the UI must keep working without it.
 */
function storageGet(storage: "local" | "session", key: string): string | null {
  try {
    return window[storage === "local" ? "localStorage" : "sessionStorage"].getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: "local" | "session", key: string, value: string) {
  try {
    window[storage === "local" ? "localStorage" : "sessionStorage"].setItem(key, value);
  } catch {
    // The chat remains fully usable; only handle/session memory is unavailable.
  }
}

function storageRemove(storage: "local" | "session", key: string) {
  try {
    window[storage === "local" ? "localStorage" : "sessionStorage"].removeItem(key);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

function readSession(): Session | null {
  try {
    const value = storageGet("session", SESSION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Session;
    if (!parsed || typeof parsed.token !== "string" || !parsed.token) return null;
    // Sessions without a join timestamp predate the socket protocol; the user
    // rejoins and gets a fresh one.
    if (typeof parsed.joinedAt !== "number") return null;
    // Sessions without a history boundary predate the 20-line join window;
    // the user rejoins and gets a fresh one.
    if (typeof parsed.historyFromRow !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function hasNameOverride() {
  return new URLSearchParams(window.location.search).has("name");
}

function initialHandle() {
  const params = new URLSearchParams(window.location.search);
  return params.has("name")
    ? (params.get("name") ?? "")
    : (storageGet("local", HANDLE_KEY) ?? "");
}

export function App() {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [handle, setHandle] = useState(initialHandle);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [soundOn, setSoundOn] = useState(() => storageGet("local", SOUND_KEY) !== "off");
  const [mentionSelection, setMentionSelection] = useState<number | null>(null);
  const [mentionDismissedAt, setMentionDismissedAt] = useState<number | null>(null);
  const [parkedKey, setParkedKey] = useState<"enter" | "tab" | null>(null);
  const handleChatKeyRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const titleTimers = useRef<{ timeout: number | undefined; interval: number | undefined }>({
    timeout: undefined,
    interval: undefined,
  });
  const chatRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const wasNearBottomRef = useRef(true);
  const autoJoinAttemptRef = useRef("");

  const lobbyRooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api.listRooms(),
    enabled: session === null,
    refetchInterval: 1000,
    retry: false,
  });

  // A join notice rotates "<handle> joined" through the tab title for a
  // few seconds, then restores the base title. It runs on its own timers
  // so muted or blocked audio never suppresses it; a later join replaces
  // the current notice cleanly.
  const clearTitleNotice = () => {
    window.clearTimeout(titleTimers.current.timeout);
    window.clearInterval(titleTimers.current.interval);
    titleTimers.current.timeout = undefined;
    titleTimers.current.interval = undefined;
  };
  const stopTitleNotice = () => {
    clearTitleNotice();
    document.title = BASE_TITLE;
  };
  const startTitleNotice = (handle: string) => {
    clearTitleNotice();
    // The trailing space separates the end from the start as the text
    // rotates, so "joined" is never glued to the handle.
    let rotated = `${handle} joined `;
    document.title = rotated;
    titleTimers.current.interval = window.setInterval(() => {
      // Rotate by code point so an emoji handle never splits a surrogate.
      const points = Array.from(rotated);
      rotated = points.slice(1).join("") + points[0];
      document.title = rotated;
    }, TITLE_TICK_MS);
    titleTimers.current.timeout = window.setTimeout(stopTitleNotice, TITLE_NOTICE_MS);
  };

  const endSession = (message: string) => {
    storageRemove("session", SESSION_KEY);
    setSession(null);
    setShowHelp(false);
    setWarning("");
    setError(message);
    stopTitleNotice();
  };

  const { room, status, send, pending } = useRoomConnection(session, {
    onCommand: (name) => {
      if (name === "help") setShowHelp(true);
      else if (name === "leave") endSession("");
    },
    onSessionEnded: () => endSession("Room session ended. Join again."),
    onNewcomer: (entry) => {
      if (soundOn) playJoinSound();
      startTitleNotice(entry.handle);
    },
    onNotice: setWarning,
  });

  useEffect(() => () => {
    stopTitleNotice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const participants = room.participants;
  const ownParticipant = participants.find((p) => p.participantId === session?.participantId);
  const mentionToken = ownParticipant ? mentionTokenBefore(ownParticipant.text, ownParticipant.caret) : null;
  const mentionCandidatesList: RosterEntry[] =
    mentionToken && session && mentionDismissedAt !== mentionToken.start
      ? mentionCandidates(mentionToken.prefix, participants, session.participantId)
      : [];
  const mentionOpen = mentionCandidatesList.length > 0;
  const mentionIndex = Math.max(0, mentionCandidatesList.findIndex((p) => p.participantId === mentionSelection));
  const mentionHighlighted: RosterEntry | undefined = mentionCandidatesList[mentionIndex];
  const mentionStart = mentionToken?.start;
  const committedLines = useMemo(() => sortedCommitted(room), [room]);
  const documentLines = useMemo(() => computeDocumentLines(committedLines, participants), [committedLines, participants]);

  useEffect(() => {
    if (mentionDismissedAt != null && mentionStart !== mentionDismissedAt) setMentionDismissedAt(null);
  }, [mentionStart, mentionDismissedAt]);

  const focusKeyboard = () => {
    keyboardRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!session) return;
    wasNearBottomRef.current = true;
    const timer = window.setTimeout(focusKeyboard, 0);
    return () => window.clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    if (!warning) return;
    const timer = window.setTimeout(() => setWarning(""), 3000);
    return () => window.clearTimeout(timer);
  }, [warning]);

  useEffect(() => {
    if (!showHelp) {
      if (session) focusKeyboard();
      return;
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setShowHelp(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [session, showHelp]);

  // Keys are handled at the document level so typing keeps working while the
  // capture textarea has lost focus, e.g. after selecting transcript text
  // with the mouse (task 13). Buttons, the lobby, and the help dialog keep
  // their keys.
  useEffect(() => {
    if (!session) return;
    const onDocumentKey = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (active !== document.body && active !== chatRef.current && active !== keyboardRef.current) return;
      if (handleChatKeyRef.current(event)) focusKeyboard();
    };
    document.addEventListener("keydown", onDocumentKey);
    return () => document.removeEventListener("keydown", onDocumentKey);
  }, [session]);

  useEffect(() => {
    const chat = chatRef.current;
    if (chat && wasNearBottomRef.current) {
      chat.scrollTop = chat.scrollHeight;
    }
  }, [documentLines]);

  // Size the session layout to the visual viewport so the caret and newest
  // lines stay above the on-screen keyboard (task 19). The variables default
  // to the CSS fallbacks, so desktops and browsers without visualViewport
  // are untouched.
  useEffect(() => {
    if (!session) return;
    const vv = window.visualViewport;
    const container = containerRef.current;
    if (!vv || !container) return;
    const applyViewport = () => {
      container.style.setProperty("--app-height", `${vv.height}px`);
      container.style.setProperty("--app-offset", `${vv.offsetTop}px`);
      if (wasNearBottomRef.current) {
        const chat = chatRef.current;
        if (chat) chat.scrollTop = chat.scrollHeight;
      }
    };
    applyViewport();
    vv.addEventListener("resize", applyViewport);
    vv.addEventListener("scroll", applyViewport);
    return () => {
      vv.removeEventListener("resize", applyViewport);
      vv.removeEventListener("scroll", applyViewport);
    };
  }, [session]);

  const onChatScroll = (event: UIEvent<HTMLElement>) => {
    const chat = event.currentTarget;
    wasNearBottomRef.current =
      chat.scrollHeight - chat.scrollTop - chat.clientHeight <= 80;
  };

  const rememberHandle = (cleanHandle: string) => {
    if (!hasNameOverride()) {
      storageSet("local", HANDLE_KEY, cleanHandle);
    }
  };

  const finishJoin = (
    room: { id: number; name: string },
    participant: { id: number; handle: string; token: string; joinedAt: number; historyFromRow: number },
    cleanHandle: string,
  ) => {
    const nextSession: Session = {
      roomId: room.id,
      roomName: room.name,
      participantId: participant.id,
      handle: participant.handle,
      token: participant.token,
      joinedAt: participant.joinedAt,
      historyFromRow: participant.historyFromRow,
    };
    rememberHandle(cleanHandle);
    storageSet("session", SESSION_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
  };

  const joinListedRoom = async (room: { id: number; name: string }) => {
    const cleanHandle = handle.trim();
    if (!cleanHandle || joining) return;

    setJoining(true);
    setError("");
    try {
      const { participant } = await api.joinRoom({
        roomId: room.id,
        handle: cleanHandle,
      });
      finishJoin(room, participant, cleanHandle);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not join room");
    } finally {
      setJoining(false);
    }
  };

  const createAndJoin = async (forceNew: boolean, preferredId?: number) => {
    const cleanHandle = handle.trim();
    if (!cleanHandle || joining) return;

    setJoining(true);
    setError("");
    try {
      const { room } = await api.getOrCreateRoom({
        preferredId,
        forceNew,
      });
      const { participant } = await api.joinRoom({
        roomId: room.id,
        handle: cleanHandle,
      });
      finishJoin(room, participant, cleanHandle);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not join room");
    } finally {
      setJoining(false);
    }
  };

  const saveHandle = (event: FormEvent) => {
    event.preventDefault();
    const cleanHandle = handle.trim();
    if (!cleanHandle) return;
    rememberHandle(cleanHandle);
    setHandle(cleanHandle);
  };

  useEffect(() => {
    if (session || joining) return;
    const params = new URLSearchParams(window.location.search);
    const preferredId = Number(params.get("room"));
    const cleanHandle = handle.trim();
    if (!Number.isInteger(preferredId) || preferredId <= 0 || !cleanHandle) {
      return;
    }

    const attemptKey = `${preferredId}:${cleanHandle.toLocaleLowerCase()}`;
    if (autoJoinAttemptRef.current === attemptKey) return;
    autoJoinAttemptRef.current = attemptKey;
    void createAndJoin(false, preferredId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, joining, session]);

  // The only deliberate exits: reloads and closed tabs never leave, so a
  // reload reconnects with the stored session and token while a closed tab
  // lingers until the server's stale sweep.
  const leave = () => {
    if (!session) return;
    api.leaveRoom({ roomId: session.roomId, participantId: session.participantId, token: session.token })
      .catch(() => { /* the server sweeps us if the request is lost */ })
      .finally(() => endSession(""));
  };

  // Input never touches the transcript: the server's echo does.
  const appendCharacter = (char: string) => {
    if (!session || !isValidChar(char)) return;
    send({ kind: "char", char });
  };
  const eraseCharacter = () => { if (session) send({ kind: "backspace" }); };
  const submitActiveLine = () => { if (session) send({ kind: "enter" }); };
  const moveMention = (delta: number) => {
    const count = mentionCandidatesList.length;
    if (!count) return;
    setMentionSelection(mentionCandidatesList[(mentionIndex + delta + count) % count].participantId);
  };
  const pickMention = (entry?: RosterEntry) => {
    const chosen = entry ?? mentionHighlighted;
    if (!mentionToken || !chosen) return;
    for (const char of mentionCompletion(chosen.handle, mentionToken.prefix)) appendCharacter(char);
    setMentionDismissedAt(mentionToken.start);
  };
  const dismissMention = () => { if (mentionToken) setMentionDismissedAt(mentionToken.start); };
  // The list follows the echo, so a pick made while keystrokes are still in
  // flight would complete a token the server no longer has. Such a key is
  // parked and resolved below once every keystroke has echoed. A pick only
  // ever runs on an empty queue, so a whole handle always fits in it.
  const pickOrPark = (key: "enter" | "tab") => { if (pending > 0) setParkedKey(key); else pickMention(); };
  const onEnter = () => { if (mentionOpen) pickOrPark("enter"); else submitActiveLine(); };

  useEffect(() => {
    if (parkedKey == null || pending > 0) return;
    setParkedKey(null);
    if (mentionOpen) pickMention();
    else if (parkedKey === "enter") submitActiveLine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parkedKey, pending, mentionOpen]);

  // Key-to-keystroke mapping for the document-level listener: sends the
  // matching chat keystroke and reports whether the key was chat input.
  // Ctrl/Alt+Arrow moves by word; every other modifier combination keeps its
  // browser meaning (copy, paste, ...).
  const handleChatKey = (event: KeyboardEvent) => {
    if (!session || event.metaKey) return false;
    // Keys inside an IME composition belong to the composition; the textarea
    // input path receives the composed text when it is confirmed.
    if (event.isComposing) return false;

    if (event.ctrlKey || event.altKey) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        send({ kind: "word-left" });
        return true;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        send({ kind: "word-right" });
        return true;
      }
      return false;
    }

    if (mentionOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveMention(event.key === "ArrowDown" ? 1 : -1);
        return true;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        pickOrPark("tab");
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismissMention();
        return true;
      }
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      eraseCharacter();
      return true;
    }

    if (event.key === "Delete") {
      event.preventDefault();
      send({ kind: "delete" });
      return true;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onEnter();
      return true;
    }

    const movementKind = MOVEMENT_KINDS[event.key as keyof typeof MOVEMENT_KINDS];
    if (movementKind) {
      event.preventDefault();
      send({ kind: movementKind });
      return true;
    }

    if (Array.from(event.key).length !== 1) return false;
    event.preventDefault();
    appendCharacter(event.key);
    return true;
  };

  handleChatKeyRef.current = handleChatKey;

  const onKeyboardInput = (event: FormEvent<HTMLTextAreaElement>) => {
    if (!session) return;
    const nativeEvent = event.nativeEvent as InputEvent;
    event.currentTarget.value = "";
    if (nativeEvent.isComposing) return;

    if (nativeEvent.inputType === "deleteContentBackward") {
      eraseCharacter();
      return;
    }
    if (nativeEvent.inputType === "deleteContentForward") {
      send({ kind: "delete" });
      return;
    }
    if (nativeEvent.inputType === "insertLineBreak") {
      onEnter();
      return;
    }
    if (!nativeEvent.inputType.startsWith("insert") || !nativeEvent.data) {
      return;
    }

    for (const char of Array.from(nativeEvent.data)) {
      appendCharacter(char);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    if (!session) return;
    event.preventDefault();
    const characters = Array.from(event.clipboardData.getData("text"));
    if (characters.length > 100) setWarning("Paste limited to 100 characters");
    for (const char of characters.slice(0, 100)) if (isValidChar(char)) send({ kind: "char", char });
  };

  if (!session) {
    const rooms = lobbyRooms.data?.rooms ?? [];
    const hasHandle = handle.trim().length > 0;
    return (
      <main id="container" aria-label="Remart BBS Chat">
        <section id="chat-area" className="lobby-shell" aria-label="Room lobby">
          <div className="lobby">
            <form className="join-form" onSubmit={saveHandle}>
              <label htmlFor="handle">Handle</label>
              <div className="handle-row">
                <input
                  id="handle"
                  name="handle"
                  aria-label="Handle"
                  autoComplete="nickname"
                  maxLength={32}
                  value={handle}
                  onChange={(event) => {
                    setHandle(event.target.value);
                    setError("");
                  }}
                  autoFocus={!hasHandle}
                />
                <button type="submit" disabled={!hasHandle}>
                  Use name
                </button>
              </div>
            </form>

            <div className="lobby-heading">ROOMS</div>
            {lobbyRooms.isLoading ? (
              <div className="lobby-status" role="status">Checking rooms...</div>
            ) : null}
            {lobbyRooms.isError ? (
              <div className="error-line" role="alert">Could not load rooms.</div>
            ) : null}

            {rooms.length ? (
              <div className="lobby-rooms">
                {rooms.map((room) => {
                  const full = (room.occupancy ?? 0) >= (room.max ?? 10);
                  return (
                    <div
                      className={`lobby-room${full ? " full" : ""}`}
                      key={room.id}
                    >
                      <div className="lobby-room-details">
                        <span>
                          {room.name} ({room.occupancy}/{room.max}{full ? " full" : ""})
                        </span>
                        {room.isLobby ? (
                          <span className="lobby-flag">lobby</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="lobby-join-button"
                        aria-label={`Join ${room.name}`}
                        disabled={full || joining || !hasHandle}
                        onClick={() => void joinListedRoom(room)}
                      >
                        {full ? "Full" : joining ? "Joining..." : "Join"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : !lobbyRooms.isLoading && !lobbyRooms.isError ? (
              <div className="lobby-empty">No rooms are open.</div>
            ) : null}

            <button
              type="button"
              className="lobby-new-room"
              disabled={joining || !hasHandle}
              onClick={() => void createAndJoin(true)}
            >
              {joining
                ? "Connecting..."
                : rooms.length
                  ? "New Room"
                  : "Create first room"}
            </button>

            {error ? (
              <div className="error-line" role="alert">
                {error}
              </div>
            ) : null}
          </div>
        </section>
      </main>
    );
  }

  /*
   * Color identifies each author, so chat lines never need nickname prefixes.
   * One shared scrolling document holds both committed and live lines in
   * server-assigned row order. Text appears only when the server echoes it;
   * Enter commits the live line in place and the next first character claims
   * a new row. In sequence it resembles IRC; simultaneous typing reveals
   * Remart's distinct model. The top-right roster carries names and roughly
   * ten distinct colors. Rooms are ephemeral.
   */
  return (
    <main id="container" aria-label="Remart BBS Chat" ref={containerRef}>
      <section
        id="chat-area"
        aria-label="Shared chat area"
        ref={chatRef}
        onClick={(event) => {
          // Link clicks navigate; focusing the keyboard would only steal
          // focus from the new tab without helping typing.
          if ((event.target as HTMLElement).closest("a")) return;
          const doc = window.getSelection();
          if (!doc || doc.rangeCount === 0 || doc.getRangeAt(0).collapsed) {
            focusKeyboard();
          }
        }}
        onPaste={onPaste}
        onScroll={onChatScroll}
      >
        <textarea
          ref={keyboardRef}
          className="keyboard-capture"
          aria-label="Chat keyboard input"
          autoCapitalize="sentences"
          autoComplete="off"
          inputMode="text"
          rows={1}
          spellCheck={false}
          onInput={onKeyboardInput}
        />
        <div className="chat-line system-line typing-hint">
          {session.roomName} — tap or click here to type · Enter sends
        </div>

        {documentLines.map((row) => {
          if (row.kind === "committed") {
            const { line } = row;
            const isSystemLine = line.text.startsWith("* ");
            return (
              <div
                className={`chat-line committed-line${
                  isSystemLine ? " system-line" : ""
                }`}
                key={row.key}
                data-document-order={row.order}
                style={{
                  color: line.color,
                }}
              >
                {line.text
                  ? splitLinks(line.text).map((segment, index) =>
                      segment.kind === "link" ? (
                        <a
                          key={index}
                          href={segment.href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {segment.text}
                        </a>
                      ) : (
                        segment.text
                      ),
                    )
                  : " "}
              </div>
            );
          }

          const { participant } = row;
          const isOwnLine = participant.participantId === session.participantId;
          // The caret rides on the echo; only the author's client draws it.
          // Mid-line it underlines the code point under it instead of adding
          // a block, so the text does not shift sideways.
          const codePoints = isOwnLine ? Array.from(participant.text) : [];
          const caret = Math.min(participant.caret, codePoints.length);
          const mentionList =
            isOwnLine && mentionOpen && mentionHighlighted ? (
              <MentionList
                candidates={mentionCandidatesList}
                highlightedId={mentionHighlighted.participantId}
                onPick={pickMention}
                container={chatRef.current}
              />
            ) : null;
          return (
            <div
              className="chat-line live-line"
              key={row.key}
              data-line-slot={participant.slot}
              data-document-order={row.order}
              style={{ color: participant.color }}
            >
              {isOwnLine && caret < codePoints.length ? (
                <>
                  {codePoints.slice(0, caret).join("")}
                  <span className="caret-char" aria-label="Your typing position">{codePoints[caret]}</span>
                  {mentionList}
                  {codePoints.slice(caret + 1).join("")}
                </>
              ) : (
                <>
                  {participant.text}
                  {isOwnLine ? (
                    <span className="caret" aria-label="Your typing position"> </span>
                  ) : null}
                  {mentionList}
                </>
              )}
            </div>
          );
        })}

        {status !== "open" ? (
          <div className="chat-line system-line" role="status">
            {status === "connecting" ? "Connecting..." : "Reconnecting..."}
          </div>
        ) : null}
        {/* Local cursor preview: shown only on our own client, only while we
            have no allocated shared line. It is not a shared row — other
            clients never render it and it reserves no transcript position.
            When someone else starts a line first, theirs takes the next
            position and this preview simply stays below it. */}
        {ownParticipant?.row == null ? (
          <div className="chat-line local-cursor-preview">
            <span className="caret" aria-label="Your typing position">
              {" "}
            </span>
          </div>
        ) : null}
        {error ? (
          <div className="chat-line error-line" role="alert">
            {error}
          </div>
        ) : null}
      </section>

      <aside id="roster" aria-label="Participants">
        <div className="roster-heading">PARTICIPANTS</div>
        {participants.length ? (
          participants.map((participant) => (
            <div
              className="roster-entry"
              key={participant.participantId}
              style={{ color: participant.color }}
            >
              <span
                className="roster-color-dot"
                style={{ backgroundColor: participant.color }}
                aria-hidden="true"
              />
              <span className="roster-handle">{participant.handle}</span>
              {participant.afk ? (
                <span className="roster-afk" title="In a background tab">afk</span>
              ) : null}
            </div>
          ))
        ) : (
          <div className="roster-empty">No callers</div>
        )}
        <div className="roster-footer">
          {warning ? (
            <div className="paste-warning" role="status">
              {warning}
            </div>
          ) : null}
          <button
            type="button"
            className="help-button"
            onClick={() => setShowHelp(true)}
          >
            Help
          </button>
          <button type="button" className="leave-button" onClick={() => leave()}>
            Leave
          </button>
          <label className="sound-toggle">
            <input
              type="checkbox"
              checked={soundOn}
              onChange={(event) => {
                const next = event.target.checked;
                setSoundOn(next);
                storageSet("local", SOUND_KEY, next ? "on" : "off");
              }}
            />
            Join sound
          </label>
          <a
            className="report-link"
            href="https://github.com/kappa/remart-bbs-chat/issues/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            Report a problem
          </a>
        </div>
      </aside>

      {showHelp ? (
        <div className="help-overlay">
          <div className="help-dialog" role="dialog" aria-label="help" aria-modal="true">
            <div className="help-heading">CHAT COMMANDS</div>
            <dl className="help-list">
              <div><dt>?</dt><dd>show this help</dd></div>
              <div><dt>q</dt><dd>leave room</dd></div>
              <div><dt>Enter</dt><dd>send the current line</dd></div>
              <div><dt>Backspace</dt><dd>remove one code point before caret</dd></div>
              <div><dt>Delete</dt><dd>remove one code point after caret</dd></div>
              <div><dt>Left/Right</dt><dd>move caret one code point</dd></div>
              <div><dt>Home/End</dt><dd>move caret to line start or end</dd></div>
              <div><dt>Ctrl+Left/Ctrl+Right</dt><dd>move caret by word (Alt+Arrow on macOS)</dd></div>
              <div><dt>@</dt><dd>type @ and a name to pick a handle: Up/Down choose, Tab or Enter insert, Escape closes</dd></div>
            </dl>
            <p>Unicode supported, including Cyrillic. No character limit.</p>
            <button
              type="button"
              className="help-close"
              onClick={() => setShowHelp(false)}
              autoFocus
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
