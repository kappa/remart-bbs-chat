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
import { api, keepaliveApi } from "./api";

type Session = {
  roomId: number;
  roomName: string;
  participantId: number;
  handle: string;
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
    // Second chirp for BBS-style da-ding
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

function isValidChar(char: string): boolean {
  if (typeof char !== 'string') return false;
  const arr = Array.from(char);
  if (arr.length !== 1) return false;
  if (char === '\n' || char === '\r') return false;
  const code = char.charCodeAt(0);
  if (code < 32 && char !== ' ' && char !== '\t') return false;
  if (code === 127) return false;
  return true;
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
    return value ? (JSON.parse(value) as Session) : null;
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
  const [optimisticContent, setOptimisticContentState] = useState<string | null>(
    null,
  );
  const [pendingActions, setPendingActions] = useState(0);
  const chatRef = useRef<HTMLElement>(null);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const optimisticContentRef = useRef<string | null>(null);
  const pendingActionsRef = useRef(0);
  const wasNearBottomRef = useRef(true);
  const autoJoinAttemptRef = useRef("");
  const prevParticipantIdsRef = useRef<Set<number>>(new Set());
  const hasInitializedParticipantsRef = useRef(false);

  const lobbyRooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api.listRooms({}),
    enabled: session === null,
    refetchInterval: 1000,
    retry: false,
  });

  const roomState = useQuery({
    queryKey: ["room-state", session?.roomId],
    queryFn: () => api.getRoomState({ roomId: session!.roomId }),
    enabled: session !== null,
    refetchInterval: 2000,
    retry: false,
  });

  const setOptimisticContent = (content: string | null) => {
    optimisticContentRef.current = content;
    setOptimisticContentState(content);
  };

  useEffect(() => {
    if (!session) return;

    const sessionFailed = roomState.isError;
    const participantExpired =
      roomState.isSuccess &&
      !roomState.data.participants.some(
        (participant) => participant.id === session.participantId,
      );

    if (!sessionFailed && !participantExpired) return;
    storageRemove("session", SESSION_KEY);
    setSession(null);
    setOptimisticContent(null);
    setError("Room session ended. Join again.");
  }, [roomState.data, roomState.isError, roomState.isSuccess, session]);

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
    if (!session) return;
    let active = true;
    const currentSession = session;

    const sendHeartbeat = async () => {
      try {
        const result = await api.heartbeat({
          roomId: currentSession.roomId,
          participantId: currentSession.participantId,
        });
        if (!active) return;
        if (!result.alive) {
          storageRemove("session", SESSION_KEY);
          setSession(null);
          setOptimisticContent(null);
          setError("Room session ended. Join again.");
          return;
        }
        if (result.removed > 0) {
          await queryClient.invalidateQueries({
            queryKey: ["room-state", currentSession.roomId],
          });
        }
      } catch {
        // A transient network miss is not a disconnect; the next heartbeat or
        // any typing action refreshes presence.
      }
    };

    void sendHeartbeat();
    const heartbeatTimer = window.setInterval(() => {
      void sendHeartbeat();
    }, 12_000);
    const leaveOnPageHide = () => {
      void keepaliveApi.leaveRoom({
        roomId: currentSession.roomId,
        participantId: currentSession.participantId,
      });
    };
    window.addEventListener("pagehide", leaveOnPageHide);

    return () => {
      active = false;
      window.clearInterval(heartbeatTimer);
      window.removeEventListener("pagehide", leaveOnPageHide);
    };
  }, [queryClient, session]);

  // WebSocket live updates: use server broadcasts instead of relying only on polling
  useEffect(() => {
    if (!session) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${protocol}//${window.location.host}`;
        ws = new WebSocket(url);
      } catch {
        // Fallback to polling only if WS unavailable
        return;
      }

      ws.onopen = () => {
        try {
          ws?.send(JSON.stringify({ type: "subscribe", roomId: session.roomId }));
        } catch {}
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.roomId && msg.roomId !== session.roomId) return;
          if (msg.type === "room-update" || msg.type === "char" || msg.type === "backspace") {
            // Immediate refetch — much faster than 250ms poll, avoids char bunching
            void queryClient.invalidateQueries({ queryKey: ["room-state", session.roomId] });
          }
        } catch {
          // Non-JSON or ping — ignore, still triggers faster poll via invalidate on any message
        }
      };

      ws.onclose = () => {
        if (closed) return;
        // Reconnect with backoff
        reconnectTimer = window.setTimeout(connect, 1200) as unknown as number;
      };

      ws.onerror = () => {
        try { ws?.close(); } catch {}
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch {}
    };
  }, [queryClient, session]);

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

  const participants = roomState.data?.participants ?? [];
  const ownParticipant = participants.find(
    (participant) => participant.id === session?.participantId,
  );
  // Active content is real chat content: every visible character is already
  // legitimate, even before Enter commits the line to scrollback.
  const currentContent =
    optimisticContent ?? ownParticipant?.activeContent ?? "";
  const visibleHistory = useMemo(() => {
    if (!roomState.data || !ownParticipant) return [];
    // Seeing only lines committed after arrival recreates terminal-side scrollback:
    // no earlier room history appears when a caller joins.
    return roomState.data.history.filter(
      (line) => line.committedAt >= ownParticipant.joinedAt,
    );
  }, [ownParticipant, roomState.data]);
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
    const activeRows = participants.map((participant) => ({
      kind: "active" as const,
      key: `active:${participant.id}`,
      // Ownership assigned on first char, not on Enter: null means not yet reserved, show at bottom
      order: participant.activeLineIdx ?? Number.MAX_SAFE_INTEGER,
      participant,
    }));

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
    if (!roomState.data?.participants) return;
    const currentIds = new Set(roomState.data.participants.map(p => p.id));
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
        // Ignore our own initial join (already in prev after first load)
        if (id !== session?.participantId || prevParticipantIdsRef.current.size > 0) {
          // Only beep if it's someone else, or second+ person
          if (id !== session?.participantId) {
            hasNewcomer = true;
          }
        }
      }
    }
    prevParticipantIdsRef.current = currentIds;
    if (hasNewcomer) {
      playJoinSound();
    }
  }, [roomState.data?.participants, session?.participantId]);

  useEffect(() => {
    if (
      optimisticContent === null ||
      pendingActions !== 0 ||
      !ownParticipant
    ) {
      return;
    }
    if (ownParticipant.activeContent === optimisticContent) {
      setOptimisticContent(null);
    }
  }, [optimisticContent, ownParticipant, pendingActions]);

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

  const enqueue = (operation: () => Promise<unknown>) => {
    pendingActionsRef.current += 1;
    setPendingActions(pendingActionsRef.current);

    queueRef.current = queueRef.current
      .then(operation)
      .then(() => queryClient.invalidateQueries({ queryKey: ["room-state"] }))
      .catch((reason: unknown) => {
        setOptimisticContent(null);
        setError(reason instanceof Error ? reason.message : "Action failed");
      })
      .finally(() => {
        pendingActionsRef.current = Math.max(0, pendingActionsRef.current - 1);
        setPendingActions(pendingActionsRef.current);
      });
  };

  const rememberHandle = (cleanHandle: string) => {
    // localStorage is not real authentication, only prototype convenience.
    // The participants_handle_nocase_unique index enforces one handle across
    // all rooms. A per-tab ?name= override lets one browser test many users
    // without clobbering another test caller's remembered handle.
    if (!hasNameOverride()) {
      storageSet("local", HANDLE_KEY, cleanHandle);
    }
  };

  const finishJoin = (
    room: { id: number; name: string },
    participant: { id: number; handle: string },
    cleanHandle: string,
  ) => {
    const nextSession = {
      roomId: room.id,
      roomName: room.name,
      participantId: participant.id,
      handle: participant.handle,
    };
    rememberHandle(cleanHandle);
    storageSet("session", SESSION_KEY, JSON.stringify(nextSession));
    // A previous visit to this room may still be cached. Dropping it before
    // activating the new session prevents stale roster data from immediately
    // being mistaken for an expired participant.
    queryClient.removeQueries({ queryKey: ["room-state", room.id], exact: true });
    setSession(nextSession);
    setOptimisticContent(null);
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

  const clearActiveCommand = async (
    activeSession: Session,
    characterCount: number,
  ) => {
    for (let index = 0; index < characterCount; index += 1) {
      await api.sendBackspace({
        roomId: activeSession.roomId,
        participantId: activeSession.participantId,
      });
    }
  };

  const refreshRoster = (commandLength = 0) => {
    if (!session) return;
    const activeSession = session;
    if (commandLength > 0) setOptimisticContent("");
    enqueue(async () => {
      await clearActiveCommand(activeSession, commandLength);
      await Promise.all([
        api.getRoster({ roomId: activeSession.roomId }),
        queryClient.invalidateQueries({
          queryKey: ["room-state", activeSession.roomId],
        }),
      ]);
      setFeedback("Roster refreshed");
    });
  };

  const leave = (commandLength = 0) => {
    if (!session) return;
    const activeSession = session;
    if (commandLength > 0) setOptimisticContent("");
    enqueue(async () => {
      await clearActiveCommand(activeSession, commandLength);
      await api.leaveRoom({
        roomId: activeSession.roomId,
        participantId: activeSession.participantId,
      });
      storageRemove("session", SESSION_KEY);
      setSession(null);
      setOptimisticContent(null);
      setFeedback("");
      setWarning("");
      setShowHelp(false);
      setError("");
    });
  };

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    if (!session) return;
    event.preventDefault();

    const clipboardCharacters = Array.from(
      event.clipboardData.getData("text"),
    );
    const limitedCharacters = clipboardCharacters.slice(0, 100);
    const validCharacters = limitedCharacters.filter(
      (char) => isValidChar(char) || char === ' ' ,
    );
    const baseContent =
      optimisticContentRef.current ?? ownParticipant?.activeContent ?? "";
    const acceptedCharacters = validCharacters;
    const messages: string[] = [];

    if (clipboardCharacters.length > 100) {
      messages.push("Paste limited to 100 characters");
    }
    if (messages.length > 0) setWarning(messages.join(" · "));
    if (acceptedCharacters.length === 0) {
      return;
    }

    setOptimisticContent(`${baseContent}${acceptedCharacters.join("")}`);
    const activeSession = session;
    // Fire each char without queueing through the serial enqueue — avoids backlog under latency
    for (const char of acceptedCharacters) {
      api.sendChar({
        roomId: activeSession.roomId,
        participantId: activeSession.participantId,
        char,
      }).then(() => {
        void queryClient.invalidateQueries({ queryKey: ["room-state", activeSession.roomId] });
      }).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Send failed");
      });
    }
  };

  const appendCharacter = (char: string) => {
    if (!session) return;

    if (!isValidChar(char) && char !== ' ') {
      // Allow space explicitly, and any Unicode letter
      if (Array.from(char).length !== 1) return;
      if (char === '\n' || char === '\r') return;
    }

    const activeContent =
      optimisticContentRef.current ?? ownParticipant?.activeContent ?? "";
    setOptimisticContent(`${activeContent}${char}`);
    const activeSession = session;
    // Immediate send, not queued — local typing stays immediate, remote sees chars via WS without 250ms bunching
    api.sendChar({
      roomId: activeSession.roomId,
      participantId: activeSession.participantId,
      char,
    }).then(() => {
      // Server will broadcast via WS, but invalidate as fallback
      void queryClient.invalidateQueries({ queryKey: ["room-state", activeSession.roomId] });
    }).catch((reason: unknown) => {
      // Roll back optimistic on failure
      setOptimisticContent(optimisticContentRef.current?.slice(0, -1) ?? null);
      setError(reason instanceof Error ? reason.message : "Send failed");
    });
  };

  const eraseCharacter = () => {
    if (!session) return;
    const activeContent =
      optimisticContentRef.current ?? ownParticipant?.activeContent ?? "";
    if (activeContent.length === 0) return;

    setOptimisticContent(activeContent.slice(0, -1));
    api.sendBackspace({
      roomId: session.roomId,
      participantId: session.participantId,
    }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["room-state", session.roomId] });
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Backspace failed");
    });
  };

  const submitActiveLine = () => {
    if (!session) return;
    const activeContent =
      optimisticContentRef.current ?? ownParticipant?.activeContent ?? "";
    const command = activeContent.trim();

    if (command === "l") {
      refreshRoster(activeContent.length);
      return;
    }
    if (command === "?") {
      setOptimisticContent("");
      setShowHelp(true);
      const activeSession = session;
      enqueue(() => clearActiveCommand(activeSession, activeContent.length));
      return;
    }
    if (command === "q") {
      leave(activeContent.length);
      return;
    }
    // Allow empty lines: multiple Enters should insert empty lines
    // Do not clear the current line visually — keep it in place until server confirms commit.
    // Only the new empty active line at bottom should get the caret.
    const contentAtCommit = activeContent;
    enqueue(async () => {
      await api.commitLine({
        roomId: session.roomId,
        participantId: session.participantId,
      });
      // Clear optimistic after commit succeeds; if we had optimistic content equal to what we just committed,
      // drop it so the fresh empty active line shows.
      if (optimisticContentRef.current === contentAtCommit) {
        setOptimisticContent(null);
      } else if (optimisticContentRef.current === "") {
        // We didn't set it early, but if something else cleared it, keep null
        setOptimisticContent(null);
      }
    });
    // Keep current optimistic content visible as committed line in place — do not blank it here.
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
                  const full = room.occupancy >= room.max;
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
            // Preserve author's color even after they leave — use stored snapshot first
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
          const content = isOwnLine
            ? (optimisticContent ?? participant.activeContent)
            : participant.activeContent;
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

        {roomState.isLoading ? (
          <div className="chat-line system-line">Connecting...</div>
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
