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
  const [pendingCommits, setPendingCommits] = useState<Array<{id:string, content:string, committedAt:number, handle:string, color:string, lineIdx:number}>>([]);
  // Optimistic lineIdx for our in-progress draft, assigned on its first character
  // at the current end of the transcript (mirrors the server's greatest+1 rule).
  // While set — or while the server reports an activeLineIdx — our draft is a real
  // shared row. When neither exists we are idle: no shared row, only a local
  // cursor preview below the transcript on our own client.
  const [draftLineIdx, setDraftLineIdx] = useState<number|null>(null);
  // Indices of our own drafts finished via Enter. A delayed pre-commit
  // snapshot — or an out-of-order poll arriving after the pending commit was
  // cleaned — may still report our activeLineIdx for one of these; it must
  // never render as an active row again. Server line indices are never reused,
  // so remembering a finished index is safe.
  const finishedDraftIdxsRef = useRef<Set<number>>(new Set());
  const chatRef = useRef<HTMLElement>(null);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const optimisticContentRef = useRef<string | null>(null);
  const pendingActionsRef = useRef(0);
  const wasNearBottomRef = useRef(true);
  const autoJoinAttemptRef = useRef("");
  const prevParticipantIdsRef = useRef<Set<number>>(new Set());
  const hasInitializedParticipantsRef = useRef(false);
  const seqRef = useRef(1);

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

  // Reset seq and pending commits on new session
  useEffect(() => {
    if (session) {
      seqRef.current = 1;
      setPendingCommits([]);
      setDraftLineIdx(null);
      finishedDraftIdxsRef.current.clear();
      setOptimisticContent(null);
      optimisticContentRef.current = null;
    }
  }, [session?.participantId]);

  // Clean pendingCommits when server history includes them
  useEffect(() => {
    if (!roomState.data?.history || pendingCommits.length === 0) return;
    const history = roomState.data.history;
    setPendingCommits((prev) => {
      const remaining = prev.filter((pc) => {
        // Keep if not yet in history: check for matching content+handle
        // For empty commits, match by time proximity since multiple empties can exist
        const found = history.some((h) => {
          if (h.handle !== pc.handle) return false;
          if (h.content !== pc.content) return false;
          // If content matches and committedAt is after our optimistic commit (within reasonable window)
          // For empty string, ensure at least one matching empty exists with committedAt >= our commit time - 1s
          const histTime = h.committedAt || 0;
          return histTime >= pc.committedAt - 1000;
        });
        return !found; // keep only if not found in server history
      });
      return remaining.length === prev.length ? prev : remaining;
    });
  }, [roomState.data?.history]);

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

  // WebSocket live updates: apply char/backspace directly, room-update triggers refetch
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
          if (msg.type === "char") {
            // Don't apply own chars optimistically again (avoid duplication)
            if (msg.participantId === session.participantId) {
              // Still ensure server will eventually reconcile via room-state, but no immediate duplicate
              return;
            }
            // Directly apply to query cache to preserve transient corrections
            queryClient.setQueryData(["room-state", session.roomId], (old: any) => {
              if (!old) return old;
              const participants = old.participants?.map((p: any) => {
                if (p.id !== msg.participantId) return p;
                // If server sends position, we could reconstruct, but simple append is sufficient
                // Check if content already ends with this char to avoid double-apply on reconnect
                const current = p.activeContent || "";
                // If position matches current length, append; otherwise trust server and append if not duplicate
                if (msg.char && typeof msg.char === "string") {
                  // Avoid duplicating if already present at expected position
                  if (msg.position != null && msg.position < current.length) {
                    // If char already at position, don't duplicate
                    if (current[msg.position] === msg.char) return p;
                  }
                  return {...p, activeContent: current + msg.char, activeLineIdx: msg.lineIdx ?? p.activeLineIdx};
                }
                return p;
              });
              return {...old, participants};
            });
            return;
          }
          if (msg.type === "backspace") {
            if (msg.participantId === session.participantId) return;
            queryClient.setQueryData(["room-state", session.roomId], (old: any) => {
              if (!old) return old;
              const participants = old.participants?.map((p: any) => {
                if (p.id !== msg.participantId) return p;
                const current = p.activeContent || "";
                if (current.length === 0) return p;
                return {...p, activeContent: current.slice(0,-1), activeLineIdx: msg.lineIdx ?? p.activeLineIdx};
              });
              return {...old, participants};
            });
            return;
          }
          if (msg.type === "room-update" || msg.type === "commit") {
            void queryClient.invalidateQueries({ queryKey: ["room-state", session.roomId] });
          }
        } catch {
          // Non-JSON or ping — ignore
        }
      };

      ws.onclose = () => {
        if (closed) return;
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

  // Sync seqRef from server's expected seq to handle reloads
  useEffect(() => {
    if (!ownParticipant) return;
    const serverExpected = (ownParticipant as any).nextExpectedSeq;
    if (typeof serverExpected === "number" && serverExpected > seqRef.current) {
      seqRef.current = serverExpected;
    }
  }, [ownParticipant]);

  // Allocate our draft line optimistically on its first character: it takes the
  // current end of the transcript, matching the server's greatest+1 rule.
  // No-ops when the draft is already allocated or the server has allocated one.
  // (The server's idx is stale while its line is still in pendingCommits —
  // we committed it locally — or while it names a finished draft, e.g. from a
  // delayed pre-commit snapshot. Either way it counts as unallocated here.)
  const ensureDraftAllocated = () => {
    if (draftLineIdx != null) return;
    const serverIdx = (ownParticipant as any)?.activeLineIdx ?? null;
    const stale =
      serverIdx != null &&
      (pendingCommits.some((pc) => pc.lineIdx === serverIdx) ||
        finishedDraftIdxsRef.current.has(serverIdx));
    if (!stale && serverIdx != null) return;
    let maxKnown = -1;
    for (const h of visibleHistory) if ((h as any).lineIdx > maxKnown) maxKnown = (h as any).lineIdx;
    for (const pc of pendingCommits) if (pc.lineIdx > maxKnown) maxKnown = pc.lineIdx;
    for (const p of participants) if ((p as any).activeLineIdx != null && (p as any).activeLineIdx > maxKnown) maxKnown = (p as any).activeLineIdx;
    setDraftLineIdx(maxKnown + 1);
  };

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
    if (!roomState.data?.history || !ownParticipant) return;
    const joinedAt = (ownParticipant as any).joinedAt;
    if (!joinedAt) return;
    setHistoryAccum((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const line of roomState.data.history) {
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
  }, [roomState.data?.history, (ownParticipant as any)?.joinedAt]);

  // Active content is real chat content: every visible character is already
  // legitimate, even before Enter commits the line to scrollback.
  const currentContent =
    optimisticContent ?? ownParticipant?.activeContent ?? "";
  const visibleHistory = useMemo(() => {
    if (!ownParticipant) return [];
    // Accumulated scrollback since arrival, sorted by server-assigned order.
    // Snapshot cutoff does not delete viewer history.
    // Include current snapshot immediately so first paint isn't empty before accum effect runs.
    const map = new Map(historyAccum);
    for (const line of roomState.data?.history ?? []) {
      if ((line as any).committedAt < (ownParticipant as any).joinedAt) continue;
      if (!map.has(line.id)) map.set(line.id, line as any);
    }
    const all = Array.from(map.values()) as any[];
    return all.sort((a, b) => a.lineIdx - b.lineIdx);
  }, [historyAccum, ownParticipant, roomState.data?.history]);
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
    // Optimistic pending commits: keep finished line visible before server confirms
    const pendingRows = pendingCommits.map((pc) => ({
      kind: "committed" as const,
      key: `pending:${pc.id}`,
      order: pc.lineIdx,
      line: {
        id: pc.id,
        handle: pc.handle,
        content: pc.content,
        lineIdx: pc.lineIdx,
        committed: true,
        committedAt: pc.committedAt,
        color: pc.color,
      },
    }));

    const activeRows = participants.flatMap((participant) => {
      const isOwn = session != null && participant.id === session.participantId;
      const serverIdx: number | null = (participant as any).activeLineIdx ?? null;
      // Our own server allocation is stale while its line sits in pendingCommits
      // (we already committed that line locally), or while it names a draft we
      // finished via Enter (delayed pre-commit snapshot / out-of-order poll):
      // it must not render as an active row again.
      const staleOwn =
        isOwn && serverIdx != null &&
        (pendingCommits.some((pc) => pc.lineIdx === serverIdx) ||
          finishedDraftIdxsRef.current.has(serverIdx));
      // A shared active row exists only for an allocated line: the server's
      // activeLineIdx, or our own optimistic draft (first char typed, server
      // hasn't allocated yet). An idle participant — no allocation — renders no
      // shared row at all; their own client shows a local cursor preview instead.
      // Note: an allocated line backspaced to empty keeps its row and position.
      let order: number | null = staleOwn ? null : serverIdx;
      if (order == null && isOwn) order = draftLineIdx;
      if (order == null) return [];
      return [{
        kind: "active" as const,
        key: `active:${participant.id}`,
        order,
        participant,
      }];
    });

    // Committed history and live lines are one document. A line's order key,
    // never its type, determines where it renders. Enter therefore changes a
    // row from active to committed without moving the text, and deferred
    // ownership ensures first typer comes first.
    return [...committedRows, ...pendingRows, ...activeRows].sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.key.localeCompare(right.key);
    });
  }, [participants, visibleHistory, pendingCommits, session, draftLineIdx]);
  const documentSignature = documentLines
    .map((row) =>
      row.kind === "active"
        ? `${row.key}:${row.order}:${row.participant.activeContent}`
        : `${row.key}:${row.order}`,
    )
    .join("\u0000") + `\u0000own:${draftLineIdx}:${optimisticContent ?? ""}`;

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
      const seq = seqRef.current++;
      await api.sendBackspace({
        roomId: activeSession.roomId,
        participantId: activeSession.participantId,
        seq,
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

    ensureDraftAllocated();
    setOptimisticContent(`${baseContent}${acceptedCharacters.join("")}`);
    const activeSession = session;
    // Fire each char with seq, ordered stream but concurrent sends — server buffers out-of-order
    for (const char of acceptedCharacters) {
      const seq = seqRef.current++;
      api.sendChar({
        roomId: activeSession.roomId,
        participantId: activeSession.participantId,
        char,
        seq,
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
    ensureDraftAllocated();
    setOptimisticContent(`${activeContent}${char}`);
    const activeSession = session;
    const seq = seqRef.current++;
    // Immediate send with seq — server will buffer out-of-order, preserving order without blocking UI
    api.sendChar({
      roomId: activeSession.roomId,
      participantId: activeSession.participantId,
      char,
      seq,
    }).then((res:any) => {
      if(res?.buffered){
        // Buffered by server, will be applied when earlier seq arrives — no rollback needed
        return;
      }
      // Server will broadcast via WS, but invalidate as fallback for polling clients
      void queryClient.invalidateQueries({ queryKey: ["room-state", activeSession.roomId] });
    }).catch((reason: unknown) => {
      // Roll back optimistic on failure (except 202 which is not an error)
      const msg = reason instanceof Error ? reason.message : "";
      if(msg.includes("202") || msg.includes("buffered")) return;
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
    const seq = seqRef.current++;
    api.sendBackspace({
      roomId: session.roomId,
      participantId: session.participantId,
      seq,
    }).then((res:any) => {
      if(res?.buffered) return;
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
    // Separate responsibilities: keep finished line visible (pendingCommits) AND start fresh buffer (optimisticContent="")
    const contentAtCommit = activeContent;
    // The line being committed is the line currently being edited. The server's
    // activeLineIdx is authoritative when known; otherwise keep the optimistic
    // draftLineIdx allocated on the first character. Recomputing here would
    // lose the draft's allocation if a remote line arrived in the meantime,
    // and a delayed pre-commit snapshot would then resurrect the finished
    // draft as a second active row. Only with neither (Enter on an untouched
    // buffer) allocate after max known.
    let commitLineIdx: number;
    if (ownParticipant?.activeLineIdx != null && pendingCommits.length === 0) {
      commitLineIdx = ownParticipant.activeLineIdx;
    } else if (draftLineIdx != null) {
      commitLineIdx = draftLineIdx;
    } else {
      let maxKnown = -1;
      for (const h of visibleHistory) if (h.lineIdx > maxKnown) maxKnown = h.lineIdx;
      for (const pc of pendingCommits) if (pc.lineIdx > maxKnown) maxKnown = pc.lineIdx;
      for (const p of participants) if (p.activeLineIdx != null && p.activeLineIdx > maxKnown) maxKnown = p.activeLineIdx;
      commitLineIdx = maxKnown + 1;
      if (visibleHistory.length === 0 && pendingCommits.length === 0 && commitLineIdx < 0) commitLineIdx = 0;
    }
    // This draft is finished: even a delayed pre-commit snapshot reporting our
    // activeLineIdx must not render it as an active row again.
    finishedDraftIdxsRef.current.add(commitLineIdx);
    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    // Immediately start fresh local buffer for new line. The draft lineIdx is
    // cleared: until the next first character there is no allocated line, so
    // no shared row renders — only the local cursor preview below the transcript.
    setOptimisticContent("");
    setDraftLineIdx(null);
    // Keep finished line visible optimistically until server confirms
    setPendingCommits((prev) => [...prev, {
      id: pendingId,
      content: contentAtCommit,
      committedAt: Date.now(),
      handle: session.handle,
      color: ownParticipant?.color ?? "#ccc",
      lineIdx: commitLineIdx,
    }]);
    const seq = seqRef.current++;
    api.commitLine({
      roomId: session.roomId,
      participantId: session.participantId,
      seq,
    }).then((res:any) => {
      if(res?.buffered){
        // Buffered, server will apply in order — keep pending commit until history includes it
        return;
      }
      // Server will broadcast room-update, which triggers refetch that will clear pending commit
      void queryClient.invalidateQueries({ queryKey: ["room-state", session.roomId] });
    }).catch((reason: unknown) => {
      // On failure, remove pending commit and restore content
      setPendingCommits((prev) => prev.filter(pc => pc.id !== pendingId));
      setOptimisticContent(contentAtCommit);
      setError(reason instanceof Error ? reason.message : "Commit failed");
    });
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
