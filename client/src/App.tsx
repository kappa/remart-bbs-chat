import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import { api, keepaliveApi, openChatSocket, sendKey, SocketRejected, type WsMessage } from "./api";
import { isValidChar } from "./documentLines";

type Session = {
  roomId: number;
  roomName: string;
  participantId: number;
  handle: string;
  token: string;
};

const SESSION_KEY = "remart-bbs-chat.session";
const HANDLE_KEY = "remart-bbs-chat.handle";

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
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [handle, setHandle] = useState(initialHandle);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [warning, setWarning] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const chatRef = useRef<HTMLElement>(null);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wasNearBottomRef = useRef(true);
  const autoJoinAttemptRef = useRef("");
  const prevParticipantIdsRef = useRef<Set<number>>(new Set());
  const hasInitializedParticipantsRef = useRef(false);
  const seqRef = useRef(1);

  const lobbyRooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api.listRooms(),
    enabled: session === null,
    refetchInterval: 1000,
    retry: false,
  });

  // The socket is the only source of room state: a snapshot on hello, then
  // live/committed/roster/command events. Recovery is reconnect + fresh
  // snapshot; there is no HTTP polling.
  const [room, setRoom] = useState<{ roomId: number; history: any[]; participants: any[]; roster: any[] } | null>(null);
  const [connecting, setConnecting] = useState(false);

  const endSession = (message: string) => {
    storageRemove("session", SESSION_KEY);
    setSession(null);
    setRoom(null);
    setError(message);
  };

  const focusKeyboard = () => {
    keyboardRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!session) return;
    wasNearBottomRef.current = true;
    const timer = window.setTimeout(focusKeyboard, 0);
    return () => window.clearTimeout(timer);
  }, [session]);

  // Reset seq on new session
  useEffect(() => {
    if (session) {
      seqRef.current = 1;
    }
  }, [session?.participantId]);

  // Page-hide leaves the room; presence is the WebSocket (no separate heartbeat needed)
  useEffect(() => {
    if (!session) return;
    const currentSession = session;
    const leaveOnPageHide = () => {
      void keepaliveApi.leaveRoom({
        roomId: currentSession.roomId,
        participantId: currentSession.participantId,
        token: currentSession.token,
      });
    };
    window.addEventListener("pagehide", leaveOnPageHide);

    return () => {
      window.removeEventListener("pagehide", leaveOnPageHide);
    };
  }, [session]);

  // WebSocket live updates: connect, hello, then handle snapshot/live/committed/roster/command.
  useEffect(() => {
    if (!session) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: number | null = null;

    const scheduleReconnect = () => {
      if (closed) return;
      setConnecting(true);
      reconnectTimer = window.setTimeout(connect, 1200) as unknown as number;
    };

    const connect = () => {
      if (closed) return;
      setConnecting(true);
      openChatSocket(session)
        .then(({ socket, snapshot }) => {
          if (closed) {
            try { socket.close(); } catch {}
            return;
          }
          ws = socket;
          wsRef.current = socket;
          setConnecting(false);

          const applySnapshot = (msg: Extract<WsMessage, { type: 'snapshot' }>) => {
            setRoom({
              roomId: msg.roomId,
              history: msg.committed ?? [],
              participants: msg.liveLines.map((l) => ({
                id: l.participantId,
                handle: l.handle,
                color: l.color,
                lineSlot: l.slot,
                activeLineIdx: l.row,
                activeContent: l.text,
                joinedAt: (l as any).joinedAt ?? (msg.you.participantId === l.participantId ? Date.now() : 0),
                nextExpectedSeq: msg.you.participantId === l.participantId ? msg.you.nextSeq : undefined,
              })),
              roster: msg.roster ?? [],
            });
          };
          // The handshake consumed the snapshot before this handler existed.
          applySnapshot(snapshot);

          socket.onmessage = (event) => {
            try {
              const msg: WsMessage = JSON.parse(event.data);
              if (msg.type === "snapshot") {
                applySnapshot(msg);
                return;
              }
              if (msg.type === "live") {
                setRoom((old) => {
                  if (!old) return old;
                  const existing = old.participants ?? [];
                  const found = existing.some((p) => p.id === msg.participantId);
                  if (found) {
                    return {
                      ...old,
                      participants: existing.map((p) => {
                        if (p.id !== msg.participantId) return p;
                        return { ...p, activeLineIdx: msg.row, activeContent: msg.text };
                      }),
                    };
                  }
                  // New participant via live message — add them. Handle/color
                  // may be filled in by a subsequent roster message.
                  return {
                    ...old,
                    participants: [...existing, {
                      id: msg.participantId,
                      handle: `user-${msg.participantId}`,
                      color: '#ccc',
                      lineSlot: msg.participantId,
                      activeLineIdx: msg.row,
                      activeContent: msg.text,
                      joinedAt: Date.now(),
                    }],
                  };
                });
                return;
              }
              if (msg.type === "committed") {
                setRoom((old) => {
                  if (!old) return old;
                  // Append, dedupe by id, keep last 100 (server caps, but defensively truncate).
                  const existing = old.history ?? [];
                  const dedup = existing.filter((h) => h.id !== msg.line.id);
                  return { ...old, history: [...dedup, msg.line].slice(-100) };
                });
                return;
              }
              if (msg.type === "roster") {
                setRoom((old) => {
                  if (!old) return old;
                  return { ...old, roster: msg.roster ?? [] };
                });
                return;
              }
              if (msg.type === "command") {
                if (msg.name === "help") {
                  setShowHelp(true);
                } else if (msg.name === "roster") {
                  setFeedback("Roster refreshed");
                }
                return;
              }
            } catch {
              // Non-JSON or unknown — ignore
            }
          };

          socket.onclose = () => {
            if (closed) return;
            wsRef.current = null;
            scheduleReconnect();
          };
        })
        .catch((reason) => {
          if (closed) return;
          // The server rejected the session itself; retrying cannot help.
          if (reason instanceof SocketRejected &&
              (reason.code === 'unknown-participant' || reason.code === 'unauthorized')) {
            endSession("Room session ended. Join again.");
            return;
          }
          scheduleReconnect();
        });
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch {}
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.participantId]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 2000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

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

  const participants = room?.participants ?? [];
  const ownParticipant = participants.find(
    (participant) => participant.id === session?.participantId,
  );

  // Sync seqRef from server's expected seq to handle reloads
  useEffect(() => {
    if (!ownParticipant) return;
    const serverExpected = (ownParticipant as any).nextExpectedSeq;
    if (typeof serverExpected === "number" && serverExpected > seqRef.current) {
      seqRef.current = serverExpected;
    }
  }, [ownParticipant]);

  // --- Scrollback belongs to the viewer, not the snapshot ---
  // Server returns only last 100 committed lines as bounded recovery snapshot.
  // Viewer accumulates everything seen since join so upward reading never loses text.
  const [historyAccum, setHistoryAccum] = useState<Map<string, any>>(new Map());

  // Clear accum on session switch
  useEffect(() => {
    setHistoryAccum(new Map());
  }, [session?.participantId]);

  // Merge latest snapshot into accum, filtered by joinedAt (no pre-join history)
  useEffect(() => {
    if (!room?.history || !ownParticipant) return;
    const joinedAt = (ownParticipant as any).joinedAt;
    if (joinedAt == null) return;
    setHistoryAccum((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const line of room.history) {
        if ((line as any).committedAt < joinedAt) continue;
        const existing = next.get(line.id);
        if (!existing) {
          next.set(line.id, line as any);
          changed = true;
        } else if (
          existing.content !== (line as any).content ||
          existing.lineIdx !== (line as any).lineIdx ||
          (existing as any).color !== (line as any).color
        ) {
          next.set(line.id, line as any);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [room?.history, (ownParticipant as any)?.joinedAt]);

  // Active content is real chat content: every visible character is already
  // legitimate, even before Enter commits the line to scrollback.
  const currentContent = ownParticipant?.activeContent ?? "";
  const visibleHistory = useMemo(() => {
    if (!ownParticipant) return [];
    // Accumulated scrollback since arrival, sorted by server-assigned order.
    // Snapshot cutoff does not delete viewer history.
    // Include current snapshot immediately so first paint isn't empty before accum effect runs.
    const map = new Map(historyAccum);
    for (const line of room?.history ?? []) {
      if ((line as any).committedAt < (ownParticipant as any).joinedAt) continue;
      if (!map.has(line.id)) map.set(line.id, line as any);
    }
    const all = Array.from(map.values()) as any[];
    return all.sort((a, b) => a.lineIdx - b.lineIdx);
  }, [historyAccum, ownParticipant, room?.history]);
  const colorByHandle = useMemo(
    () =>
      new Map(
        participants.map((participant) => [
          participant.handle,
          participant.color,
        ]),
      ),
    [participants],
  );
  const orderedParticipants = useMemo(
    () => [...participants].sort((a, b) => a.lineSlot - b.lineSlot),
    [participants],
  );
  const documentLines = useMemo(() => {
    const committedRows = visibleHistory.map((line) => ({
      kind: "committed" as const,
      key: `committed:${line.id}`,
      order: line.lineIdx,
      line,
    }));

    const activeRows = participants.flatMap((participant) => {
      const serverIdx: number | null = (participant as any).activeLineIdx ?? null;
      // A shared active row exists only for an allocated line.
      // Note: an allocated line backspaced to empty keeps its row and position.
      if (serverIdx == null) return [];
      return [{
        kind: "active" as const,
        key: `active:${participant.id}`,
        order: serverIdx,
        participant,
      }];
    });

    // Committed history and live lines are one document. A line's order key,
    // never its type, determines where it renders. Enter therefore changes a
    // row from active to committed without moving the text, and deferred
    // ownership ensures first typer comes first.
    return [...committedRows, ...activeRows].sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.key.localeCompare(right.key);
    });
  }, [participants, visibleHistory]);
  const documentSignature = documentLines
    .map((row) =>
      row.kind === "active"
        ? `${row.key}:${row.order}:${row.participant.activeContent}`
        : `${row.key}:${row.order}`,
    )
    .join("\u0000");

  useEffect(() => {
    if (!room?.participants) return;
    const currentIds = new Set(room.participants.map(p => p.id));
    if (!hasInitializedParticipantsRef.current) {
      // First load — don't beep, just remember
      hasInitializedParticipantsRef.current = true;
      prevParticipantIdsRef.current = currentIds;
      return;
    }
    // Someone new arrived who wasn't there before, and it's not just us
    let hasNewcomer = false;
    for (const id of currentIds) {
      if (!prevParticipantIdsRef.current.has(id)) {
        if (id !== session?.participantId) {
          hasNewcomer = true;
        }
      }
    }
    prevParticipantIdsRef.current = currentIds;
    if (hasNewcomer) {
      playJoinSound();
    }
  }, [room?.participants, session?.participantId]);

  useEffect(() => {
    const chat = chatRef.current;
    if (chat && wasNearBottomRef.current) {
      chat.scrollTop = chat.scrollHeight;
    }
  }, [documentSignature]);

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
    participant: { id: number; handle: string; token: string },
    cleanHandle: string,
  ) => {
    const nextSession: Session = {
      roomId: room.id,
      roomName: room.name,
      participantId: participant.id,
      handle: participant.handle,
      token: participant.token,
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
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
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
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
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
  }, [handle, joining, session]);

  // Send a keystroke over the WebSocket; server is the source of truth for
  // ordering and echo (live/committed/command).
  const sendKeyOverSocket = (kind: "char" | "backspace" | "enter", char?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) {
      setError("Connection lost; refresh to reconnect.");
      return;
    }
    const seq = seqRef.current++;
    sendKey(ws, { type: "key", kind, seq, char });
  };

  const appendCharacter = (char: string) => {
    if (!session) return;

    if (!isValidChar(char) && char !== " ") {
      if (Array.from(char).length !== 1) return;
      if (char === "\n" || char === "\r") return;
    }

    sendKeyOverSocket("char", char);
  };

  const eraseCharacter = () => {
    if (!session) return;
    const activeContent = ownParticipant?.activeContent ?? "";
    if (activeContent.length === 0) return;
    sendKeyOverSocket("backspace");
  };

  const submitActiveLine = () => {
    if (!session) return;
    sendKeyOverSocket("enter");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!session || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "Backspace") {
      event.preventDefault();
      eraseCharacter();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submitActiveLine();
      return;
    }

    const isSingleInputCharacter = Array.from(event.key).length === 1;
    if (!isSingleInputCharacter) return;
    event.preventDefault();
    appendCharacter(event.key);
  };

  const onKeyboardInput = (event: FormEvent<HTMLTextAreaElement>) => {
    if (!session) return;
    const nativeEvent = event.nativeEvent as InputEvent;
    event.currentTarget.value = "";
    if (nativeEvent.isComposing) return;

    if (nativeEvent.inputType === "deleteContentBackward") {
      eraseCharacter();
      return;
    }
    if (nativeEvent.inputType === "insertLineBreak") {
      submitActiveLine();
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

    const clipboardCharacters = Array.from(
      event.clipboardData.getData("text"),
    );
    const limitedCharacters = clipboardCharacters.slice(0, 100);
    const validCharacters = limitedCharacters.filter(
      (char) => isValidChar(char) || char === " ",
    );
    const messages: string[] = [];

    if (clipboardCharacters.length > 100) {
      messages.push("Paste limited to 100 characters");
    }
    if (messages.length > 0) setWarning(messages.join(" · "));
    if (validCharacters.length === 0) {
      return;
    }

    for (const char of validCharacters) {
      appendCharacter(char);
    }
  };

  const refreshRoster = () => {
    if (!session) return;
    // Send a single "l" character followed by Enter so the server's command
    // path clears the line and the server sends a `command:roster` to us.
    sendKeyOverSocket("char", "l");
    sendKeyOverSocket("enter");
  };

  const showHelpCommand = () => {
    if (!session) return;
    sendKeyOverSocket("char", "?");
    sendKeyOverSocket("enter");
  };

  const leave = () => {
    if (!session) return;
    const activeSession = session;
    // q + Enter: server's command path closes our socket and removes us.
    sendKeyOverSocket("char", "q");
    sendKeyOverSocket("enter");
    // Optimistically clear local session; if the server keeps us (e.g. q
    // wasn't alone, e.g. " q"), the next snapshot will refresh state.
    storageRemove("session", SESSION_KEY);
    setSession(null);
    setFeedback("");
    setWarning("");
    setShowHelp(false);
    setError("");
    void activeSession;
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
   * One shared scrolling document holds both committed and active lines in
   * server-assigned order. Every participant owns exactly one editable line;
   * Enter commits it in place and allocates a new one at the bottom. In sequence it resembles IRC;
   * simultaneous typing reveals Remart's distinct model. The top-right roster
   * carries names and roughly ten distinct colors. Rooms are ephemeral, and
   * browser-native scrollback plus no history on join are intentional features.
   */
  return (
    <main id="container" aria-label="Remart BBS Chat">
      <section
        id="chat-area"
        aria-label="Shared chat area"
        ref={chatRef}
        onClick={focusKeyboard}
        onKeyDown={onKeyDown}
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
            const isSystemLine = line.content.startsWith("* ");
            const lineColor = (line as any).color ?? colorByHandle.get(line.handle) ?? (isSystemLine ? "var(--dim)" : "var(--text)");
            return (
              <div
                className={`chat-line committed-line${
                  isSystemLine ? " system-line" : ""
                }`}
                key={row.key}
                data-document-order={row.order}
                style={{
                  color: lineColor,
                }}
              >
                {line.content || " "}
              </div>
            );
          }

          const { participant } = row;
          const isOwnLine = participant.id === session.participantId;
          const content = participant.activeContent;
          return (
            <div
              className="chat-line active-line"
              key={row.key}
              data-line-slot={participant.lineSlot}
              data-document-order={row.order}
              style={{ color: participant.color }}
            >
              {content}
              {isOwnLine ? (
                <span className="caret" aria-label="Your typing position"> </span>
              ) : null}
            </div>
          );
        })}

        {connecting ? (
          <div className="chat-line system-line">Connecting...</div>
        ) : null}
        {/* Local cursor preview: shown only on our own client, only while we
            have no allocated shared line. It is not a shared row — other
            clients never render it and it reserves no transcript position.
            When someone else starts a line first, theirs takes the next
            position and this preview simply stays below it. */}
        {session &&
        !documentLines.some(
          (row) =>
            row.kind === "active" &&
            row.participant.id === session.participantId,
        ) ? (
          <div className="chat-line local-cursor-preview">
            <span className="caret" aria-label="Your typing position">
              {" "}
            </span>
          </div>
        ) : null}
        {feedback ? (
          <div className="chat-line system-line" role="status">
            {feedback}
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
        {orderedParticipants.length ? (
          orderedParticipants.map((participant) => (
            <div
              className="roster-entry"
              key={participant.id}
              style={{ color: participant.color }}
            >
              <span
                className="roster-color-dot"
                style={{ backgroundColor: participant.color }}
                aria-hidden="true"
              />
              <span className="roster-handle">{participant.handle}</span>
            </div>
          ))
        ) : (
          <div className="roster-empty">No callers</div>
        )}
        <div className="roster-footer">
          <div
            className="char-counter"
            aria-live="polite"
          >
            {currentContent.length} chars
          </div>
          {warning ? (
            <div className="paste-warning" role="status">
              {warning}
            </div>
          ) : null}
          <button
            type="button"
            className="keyboard-button"
            onClick={focusKeyboard}
          >
            Type
          </button>
          <div className="command-buttons" aria-label="Chat commands">
            <button
              type="button"
              className="command-button"
              title="Refresh roster"
              onClick={() => refreshRoster()}
            >
              [l]
            </button>
            <button
              type="button"
              className="command-button"
              title="Show help"
              onClick={() => setShowHelp(true)}
            >
              [?]
            </button>
            <button
              type="button"
              className="command-button"
              title="Leave room"
              onClick={() => leave()}
            >
              [q]
            </button>
          </div>
          <button type="button" className="leave-button" onClick={() => leave()}>
            Leave
          </button>
        </div>
      </aside>

      {showHelp ? (
        <div className="help-overlay">
          <div className="help-dialog" role="dialog" aria-label="help" aria-modal="true">
            <div className="help-heading">CHAT COMMANDS</div>
            <dl className="help-list">
              <div><dt>l</dt><dd>refresh roster and list participants</dd></div>
              <div><dt>?</dt><dd>show this help</dd></div>
              <div><dt>q</dt><dd>leave room</dd></div>
              <div><dt>Enter</dt><dd>commit your line and assign a new empty line</dd></div>
              <div><dt>Backspace</dt><dd>remove one character, visibly and in order</dd></div>
            </dl>
            <p>Unicode supported, including Cyrillic. No character limit.</p>
            <p>
              For per-tab testing, use <code>?name=Alice</code> and <code>?name=Bob</code>.
              Overrides do not overwrite the handle remembered in localStorage.
            </p>
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
