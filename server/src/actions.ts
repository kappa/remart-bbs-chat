import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import * as schema from "./schema";

export const ANSI_COLORS = [
  "#00FFFF",
  "#FFFF00",
  "#FF00FF",
  "#00FF00",
  "#FF8000",
  "#80FF00",
  "#FF0080",
  "#00FF80",
  "#8080FF",
  "#FF8080",
] as const;

const HEARTBEAT_TIMEOUT_MS = 40_000;

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

const roomShape = z.object({
  id: z.number(),
  name: z.string(),
});

const participantShape = z.object({
  id: z.number(),
  roomId: z.number(),
  handle: z.string(),
  color: z.string(),
  lineSlot: z.number(),
});

const rosterEntryShape = z.object({
  handle: z.string(),
  color: z.string(),
  lineSlot: z.number(),
});

const activeParticipantShape = rosterEntryShape.extend({
  id: z.number(),
  activeLineIdx: z.number().nullable(),
  activeContent: z.string(),
  joinedAt: z.number(),
});

const historyLineShape = z.object({
  id: z.string(),
  handle: z.string(),
  content: z.string(),
  lineIdx: z.number(),
  committed: z.boolean(),
  committedAt: z.number(),
  color: z.string().optional(),
});

export const Actions = {
  getScaffoldStatus: defineAction({
    request: z.object({}),
    response: z.object({ phase: z.literal("static-layout") }),
    async handler() {
      return { phase: "static-layout" as const };
    },
  }),

  listRooms: defineAction({
    request: z.object({}),
    response: z.object({
      rooms: z.array(
        roomShape.extend({
          occupancy: z.number(),
          max: z.number(),
          isLobby: z.boolean().optional(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [roomRows, participantRows] = await Promise.all([
        db
          .select()
          .from(schema.rooms)
          .orderBy(asc(schema.rooms.createdAt), asc(schema.rooms.id)),
        db
          .select({
            roomId: schema.participants.roomId,
            lastSeen: schema.participants.lastSeen,
          })
          .from(schema.participants),
      ]);

      const occupancyByRoom = new Map<number, number>();
      const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
      for (const participant of participantRows) {
        if (participant.lastSeen.getTime() < cutoff) continue;
        occupancyByRoom.set(
          participant.roomId,
          (occupancyByRoom.get(participant.roomId) ?? 0) + 1,
        );
      }

      return {
        rooms: roomRows.map((room) => ({
          id: room.id,
          name: room.name,
          occupancy: occupancyByRoom.get(room.id) ?? 0,
          max: room.maxParticipants ?? ANSI_COLORS.length,
          isLobby: room.isLobby ?? false,
        })),
      };
    },
  }),

  getOrCreateRoom: defineAction({
    request: z.object({
      preferredId: z.number().int().positive().optional(),
      forceNew: z.boolean().optional(),
    }),
    response: z.object({ room: roomShape }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [roomRows, participantRows] = await Promise.all([
        db
          .select()
          .from(schema.rooms)
          .orderBy(asc(schema.rooms.createdAt), asc(schema.rooms.id)),
        db
          .select({
            roomId: schema.participants.roomId,
            lastSeen: schema.participants.lastSeen,
          })
          .from(schema.participants),
      ]);

      const occupancyByRoom = new Map<number, number>();
      const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
      for (const participant of participantRows) {
        if (participant.lastSeen.getTime() < cutoff) continue;
        occupancyByRoom.set(
          participant.roomId,
          (occupancyByRoom.get(participant.roomId) ?? 0) + 1,
        );
      }

      const hasSpace = (room: (typeof roomRows)[number]) =>
        (occupancyByRoom.get(room.id) ?? 0) <
        (room.maxParticipants ?? ANSI_COLORS.length);

      const preferred =
        args.preferredId === undefined
          ? undefined
          : roomRows.find((room) => room.id === args.preferredId);
      const available = args.forceNew
        ? undefined
        : args.preferredId !== undefined
          ? preferred && hasSpace(preferred)
            ? preferred
            : undefined
          : roomRows.find((room) => hasSpace(room));

      if (available) {
        return { room: { id: available.id, name: available.name } };
      }

      const nextRoomNumber =
        roomRows.reduce((highest, room) => {
          const match = room.name.match(/^Room (\d+)$/);
          return match ? Math.max(highest, Number(match[1])) : highest;
        }, 0) + 1;

      const [created] = await db
        .insert(schema.rooms)
        .values({ name: `Room ${nextRoomNumber}` })
        .returning({ id: schema.rooms.id, name: schema.rooms.name });
      if (!created) {
        throw new Error("room creation failed");
      }

      ctx.invalidateQueries();
      return { room: created };
    },
  }),

  joinRoom: defineAction({
    request: z.object({
      roomId: z.number().int().positive(),
      handle: z.string().trim().min(1).max(32),
      lineSlotRequest: z.number().int().min(0).max(9).optional(),
    }),
    response: z.object({
      participant: participantShape,
      roster: z.array(rosterEntryShape),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [room] = await db
        .select()
        .from(schema.rooms)
        .where(eq(schema.rooms.id, args.roomId))
        .limit(1);
      if (!room) {
        throw new Error("room not found");
      }

      const now = Date.now();
      const cutoff = now - HEARTBEAT_TIMEOUT_MS;
      let allParticipants = await db.select().from(schema.participants);

      // Joining is also a cleanup opportunity for abandoned callers. Their
      // unfinished active text is discarded rather than becoming a ghost line;
      // committed history remains intact, while obsolete keystroke audit rows
      // are removed.
      const staleParticipants = allParticipants.filter(
        (participant) => participant.lastSeen.getTime() < cutoff,
      );
      for (const stale of staleParticipants) {
        const [roomLines, roomCallers] = await Promise.all([
          db
            .select({ lineIdx: schema.lines.lineIdx })
            .from(schema.lines)
            .where(eq(schema.lines.roomId, stale.roomId)),
          db
            .select({ activeLineIdx: schema.participants.activeLineIdx })
            .from(schema.participants)
            .where(eq(schema.participants.roomId, stale.roomId)),
        ]);
        const leaveLineIdx =
          Math.max(
            -1,
            ...roomLines.map((line) => line.lineIdx),
            ...roomCallers.map((caller) => caller.activeLineIdx),
          ) + 1;
        await db.batch([
          db.insert(schema.lines).values({
            roomId: stale.roomId,
            handle: stale.handle,
            content: `* ${stale.handle} left`,
            committed: true,
            lineIdx: leaveLineIdx,
            color: stale.color,
          }),
          db
            .delete(schema.charEvents)
            .where(
              and(
                eq(schema.charEvents.roomId, stale.roomId),
                eq(schema.charEvents.handle, stale.handle),
              ),
            ),
          db
            .delete(schema.participants)
            .where(eq(schema.participants.id, stale.id)),
        ]);
      }
      if (staleParticipants.length > 0) {
        allParticipants = await db.select().from(schema.participants);
      }

      const requestedHandle = args.handle.toLocaleLowerCase();
      const existing = allParticipants.find(
        (participant) =>
          participant.roomId === args.roomId &&
          participant.handle.toLocaleLowerCase() === requestedHandle,
      );
      if (existing) {
        throw new Error("Handle already active");
      }

      const roomLimit = Math.min(
        room.maxParticipants ?? ANSI_COLORS.length,
        ANSI_COLORS.length,
      );
      let participant:
        | {
            id: number;
            roomId: number;
            handle: string;
            color: string;
            lineSlot: number;
          }
        | undefined;
      let joinLineIdx = 0;

      for (let attempt = 0; attempt < roomLimit && !participant; attempt += 1) {
        const [roomParticipants, roomLines] = await Promise.all([
          db
            .select()
            .from(schema.participants)
            .where(eq(schema.participants.roomId, args.roomId))
            .orderBy(asc(schema.participants.lineSlot)),
          db
            .select({ lineIdx: schema.lines.lineIdx })
            .from(schema.lines)
            .where(eq(schema.lines.roomId, args.roomId)),
        ]);
        if (roomParticipants.length >= roomLimit) {
          throw new Error("room full");
        }

        const usedSlots = new Set(
          roomParticipants.map((current) => current.lineSlot),
        );
        const requestedSlot = args.lineSlotRequest;
        const lineSlot =
          requestedSlot !== undefined && !usedSlots.has(requestedSlot)
            ? requestedSlot
            : Array.from({ length: roomLimit }, (_, index) => index).find(
                (slot) => !usedSlots.has(slot),
              );
        const usedColors = new Set(
          roomParticipants.map((current) => current.color),
        );
        const color = ANSI_COLORS.find(
          (candidate) => !usedColors.has(candidate),
        );
        if (lineSlot === undefined || !color) {
          throw new Error("room full");
        }

        // The document order is independent of the fixed roster/color slot.
        // A join notice is appended, followed immediately by the caller's one
        // active line. Ownership deferred until first character typed to avoid
        // reserving order prematurely.
        const greatestLineIdx = Math.max(
          -1,
          ...roomLines.map((line) => line.lineIdx),
          ...roomParticipants.map((current) => current.activeLineIdx ?? -1),
        );
        joinLineIdx = greatestLineIdx + 1;

        try {
          const joinedAt = new Date();
          [participant] = await db
            .insert(schema.participants)
            .values({
              roomId: args.roomId,
              handle: args.handle,
              color,
              lineSlot,
              activeLineIdx: null,
              activeContent: "",
              joinedAt,
              lastSeen: joinedAt,
            })
            .returning({
              id: schema.participants.id,
              roomId: schema.participants.roomId,
              handle: schema.participants.handle,
              color: schema.participants.color,
              lineSlot: schema.participants.lineSlot,
            });
        } catch {
          const participantsAfterConflict = await db
            .select({
              roomId: schema.participants.roomId,
              handle: schema.participants.handle,
            })
            .from(schema.participants);
          const handleWasClaimed = participantsAfterConflict.some(
            (current) =>
              current.roomId === args.roomId &&
              current.handle.toLocaleLowerCase() ===
                args.handle.toLocaleLowerCase(),
          );
          if (handleWasClaimed) {
            throw new Error("Handle already active");
          }
        }
      }

      if (!participant) {
        throw new Error("room full");
      }

      // System rows share the same ordered document as committed and active
      // chat lines, so presence changes never jump around during rendering.
      const joinedAt = new Date();
      await db.insert(schema.lines).values({
        roomId: args.roomId,
        handle: participant.handle,
        content: `* ${participant.handle} joined`,
        committed: true,
        lineIdx: joinLineIdx,
        color: participant.color,
        createdAt: joinedAt,
      });

      const rosterRows = await db
        .select({
          handle: schema.participants.handle,
          color: schema.participants.color,
          lineSlot: schema.participants.lineSlot,
        })
        .from(schema.participants)
        .where(eq(schema.participants.roomId, args.roomId))
        .orderBy(asc(schema.participants.lineSlot));

      ctx.invalidateQueries();
      return { participant, roster: rosterRows };
    },
  }),

  leaveRoom: defineAction({
    request: z.object({
      roomId: z.number().int().positive(),
      participantId: z.number().int().positive(),
    }),
    response: z.object({ freed: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [participant] = await db
        .select()
        .from(schema.participants)
        .where(
          and(
            eq(schema.participants.id, args.participantId),
            eq(schema.participants.roomId, args.roomId),
          ),
        )
        .limit(1);

      if (!participant) {
        return { freed: false };
      }

      const [roomLines, roomParticipants] = await Promise.all([
        db
          .select({ lineIdx: schema.lines.lineIdx })
          .from(schema.lines)
          .where(eq(schema.lines.roomId, participant.roomId)),
        db
          .select({
            id: schema.participants.id,
            activeLineIdx: schema.participants.activeLineIdx,
          })
          .from(schema.participants)
          .where(eq(schema.participants.roomId, participant.roomId)),
      ]);
      const greatestLineIdx = Math.max(
        -1,
        ...roomLines.map((line) => line.lineIdx),
        ...roomParticipants.map((current) => current.activeLineIdx ?? -1),
      );
      const leftAt = new Date();
      const leaveLine = db.insert(schema.lines).values({
        roomId: participant.roomId,
        handle: participant.handle,
        content: `* ${participant.handle} left`,
        committed: true,
        lineIdx: greatestLineIdx + 1,
        color: participant.color,
        createdAt: leftAt,
      });
      const deleteParticipant = db
        .delete(schema.participants)
        .where(eq(schema.participants.id, participant.id));

      if (participant.activeContent.length > 0) {
        // A disconnect commits visible typing at exactly its active position;
        // the presence notice is the only new row appended at the bottom.
        await db.batch([
          db.insert(schema.lines).values({
            roomId: participant.roomId,
            handle: participant.handle,
            content: participant.activeContent,
            committed: true,
            lineIdx: participant.activeLineIdx ?? greatestLineIdx + 1,
            color: participant.color,
            createdAt: leftAt,
          }),
          leaveLine,
          deleteParticipant,
        ]);
      } else {
        await db.batch([leaveLine, deleteParticipant]);
      }

      const [remaining, roomRows] = await Promise.all([
        db
          .select({ id: schema.participants.id })
          .from(schema.participants)
          .where(eq(schema.participants.roomId, args.roomId))
          .limit(1),
        db
          .select({ isLobby: schema.rooms.isLobby })
          .from(schema.rooms)
          .where(eq(schema.rooms.id, args.roomId))
          .limit(1),
      ]);
      const room = roomRows[0];
      if (remaining.length === 0 && room && !room.isLobby) {
        // V1 rooms are ephemeral: when the final caller leaves, remove the
        // room and its entire transient character stream/history together.
        await db.batch([
          db
            .delete(schema.charEvents)
            .where(eq(schema.charEvents.roomId, args.roomId)),
          db.delete(schema.lines).where(eq(schema.lines.roomId, args.roomId)),
          db.delete(schema.rooms).where(eq(schema.rooms.id, args.roomId)),
        ]);
      }

      ctx.invalidateQueries();
      return { freed: true };
    },
  }),

  getRoster: defineAction({
    request: z.object({ roomId: z.number().int().positive() }),
    response: z.object({ participants: z.array(rosterEntryShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const participants = await db
        .select({
          handle: schema.participants.handle,
          color: schema.participants.color,
          lineSlot: schema.participants.lineSlot,
        })
        .from(schema.participants)
        .where(eq(schema.participants.roomId, args.roomId))
        .orderBy(asc(schema.participants.lineSlot));
      return { participants };
    },
  }),

  heartbeat: defineAction({
    request: z.object({
      roomId: z.number().int().positive(),
      participantId: z.number().int().positive(),
    }),
    response: z.object({ alive: z.boolean(), removed: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [participant] = await db
        .select()
        .from(schema.participants)
        .where(
          and(
            eq(schema.participants.id, args.participantId),
            eq(schema.participants.roomId, args.roomId),
          ),
        )
        .limit(1);
      if (!participant) return { alive: false, removed: 0 };

      const now = new Date();
      await db
        .update(schema.participants)
        .set({ lastSeen: now })
        .where(eq(schema.participants.id, participant.id));

      const roomParticipants = await db
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.roomId, args.roomId));
      const staleParticipants = roomParticipants.filter(
        (current) =>
          current.id !== participant.id &&
          current.lastSeen.getTime() < now.getTime() - HEARTBEAT_TIMEOUT_MS,
      );
      if (staleParticipants.length === 0) {
        return { alive: true, removed: 0 };
      }

      const roomLines = await db
        .select({ lineIdx: schema.lines.lineIdx })
        .from(schema.lines)
        .where(eq(schema.lines.roomId, args.roomId));
      let nextLineIdx =
        Math.max(
          -1,
          ...roomLines.map((line) => line.lineIdx),
          ...roomParticipants.map((current) => current.activeLineIdx ?? -1),
        ) + 1;

      for (const stale of staleParticipants) {
        await db.batch([
          db.insert(schema.lines).values({
            roomId: stale.roomId,
            handle: stale.handle,
            content: `* ${stale.handle} left`,
            committed: true,
            lineIdx: nextLineIdx,
            color: stale.color,
          }),
          db
            .delete(schema.charEvents)
            .where(
              and(
                eq(schema.charEvents.roomId, stale.roomId),
                eq(schema.charEvents.handle, stale.handle),
              ),
            ),
          db
            .delete(schema.participants)
            .where(eq(schema.participants.id, stale.id)),
        ]);
        nextLineIdx += 1;
      }

      ctx.invalidateQueries();
      return { alive: true, removed: staleParticipants.length };
    },
  }),

  sendChar: defineAction({
    request: z.object({
      roomId: z.number().int().positive(),
      participantId: z.number().int().positive(),
      char: z.string(),
    }),
    response: z.object({
      content: z.string(),
      lineIdx: z.number().nullable(),
      position: z.number(),
      participantId: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [participant] = await db
        .select()
        .from(schema.participants)
        .where(
          and(
            eq(schema.participants.id, args.participantId),
            eq(schema.participants.roomId, args.roomId),
          ),
        )
        .limit(1);
      if (!participant) {
        throw new Error("user not in room");
      }

      if (!isValidChar(args.char)) {
        throw new Error("invalid char");
      }

      const current = participant.activeContent;
      // Deferred ownership: assign lineIdx on first character if not yet assigned
      let activeLineIdx = participant.activeLineIdx;
      if (activeLineIdx == null) {
        const [roomLines, roomParticipants] = await Promise.all([
          db.select({ lineIdx: schema.lines.lineIdx }).from(schema.lines).where(eq(schema.lines.roomId, participant.roomId)),
          db.select({ activeLineIdx: schema.participants.activeLineIdx }).from(schema.participants).where(eq(schema.participants.roomId, participant.roomId)),
        ]);
        activeLineIdx = Math.max(-1, ...roomLines.map(l => l.lineIdx), ...roomParticipants.map(p => p.activeLineIdx ?? -1)) + 1;
      }

      const content = `${current}${args.char}`;
      await db.batch([
        db
          .update(schema.participants)
          .set({ activeContent: content, activeLineIdx, lastSeen: new Date() })
          .where(eq(schema.participants.id, participant.id)),
        db.insert(schema.charEvents).values({
          roomId: participant.roomId,
          handle: participant.handle,
          char: args.char,
          lineIdx: activeLineIdx,
          position: content.length - 1,
        }),
      ]);

      ctx.invalidateQueries();
      return {
        content,
        lineIdx: activeLineIdx,
        position: content.length - 1,
        participantId: participant.id,
      };
    },
  }),

  sendBackspace: defineAction({
    request: z.object({
      roomId: z.number().int().positive(),
      participantId: z.number().int().positive(),
    }),
    response: z.object({
      content: z.string(),
      lineIdx: z.number(),
      participantId: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [participant] = await db
        .select()
        .from(schema.participants)
        .where(
          and(
            eq(schema.participants.id, args.participantId),
            eq(schema.participants.roomId, args.roomId),
          ),
        )
        .limit(1);
      if (!participant) {
        throw new Error("user not in room");
      }

      if (participant.activeContent.length === 0) {
        return {
          content: "",
          lineIdx: participant.activeLineIdx,
          participantId: participant.id,
        };
      }

      const content = participant.activeContent.slice(0, -1);
      await db.batch([
        db
          .update(schema.participants)
          .set({ activeContent: content, lastSeen: new Date() })
          .where(eq(schema.participants.id, participant.id)),
        db.insert(schema.charEvents).values({
          roomId: participant.roomId,
          handle: participant.handle,
          char: "\b",
          lineIdx: participant.activeLineIdx,
          position: content.length,
        }),
      ]);

      ctx.invalidateQueries();
      return {
        content,
        lineIdx: participant.activeLineIdx,
        participantId: participant.id,
      };
    },
  }),

  commitLine: defineAction({
    request: z.object({
      roomId: z.number().int().positive(),
      participantId: z.number().int().positive(),
    }),
    response: z.object({
      newLineIdx: z.number(),
      committedContent: z.string(),
      committedAt: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [participant] = await db
        .select()
        .from(schema.participants)
        .where(
          and(
            eq(schema.participants.id, args.participantId),
            eq(schema.participants.roomId, args.roomId),
          ),
        )
        .limit(1);
      if (!participant) {
        throw new Error("user not in room");
      }

      // Allow empty lines: multiple Enters should insert empty lines
      const [roomLines, roomParticipants] = await Promise.all([
        db
          .select({ lineIdx: schema.lines.lineIdx })
          .from(schema.lines)
          .where(eq(schema.lines.roomId, participant.roomId)),
        db
          .select({ activeLineIdx: schema.participants.activeLineIdx })
          .from(schema.participants)
          .where(eq(schema.participants.roomId, participant.roomId)),
      ]);
      const greatestLineIdx = Math.max(
        participant.activeLineIdx ?? -1,
        ...roomLines.map((line) => line.lineIdx),
        ...roomParticipants.map((current) => current.activeLineIdx ?? -1),
      );
      const effectiveCommitIdx = participant.activeLineIdx ?? greatestLineIdx + 1;
      const newLineIdx = greatestLineIdx + 1;
      const committedAt = new Date();
      // Enter converts the caller's one active row into history at the exact
      // same document position. The replacement active row is deferred (null)
      // so first typer gets earliest order.
      await db.batch([
        db.insert(schema.lines).values({
          roomId: participant.roomId,
          handle: participant.handle,
          content: participant.activeContent,
          committed: true,
          lineIdx: effectiveCommitIdx,
          color: participant.color,
          createdAt: committedAt,
        }),
        db
          .update(schema.participants)
          .set({
            activeContent: "",
            activeLineIdx: null,
            lastSeen: committedAt,
          })
          .where(eq(schema.participants.id, participant.id)),
      ]);

      ctx.invalidateQueries();
      return {
        newLineIdx,
        committedContent: participant.activeContent,
        committedAt: committedAt.getTime(),
      };
    },
  }),

  getRoomState: defineAction({
    request: z.object({ roomId: z.number().int().positive() }),
    response: z.object({
      roomId: z.number(),
      history: z.array(historyLineShape),
      participants: z.array(activeParticipantShape),
      roster: z.array(rosterEntryShape),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [room] = await db
        .select({ id: schema.rooms.id })
        .from(schema.rooms)
        .where(eq(schema.rooms.id, args.roomId))
        .limit(1);
      if (!room) {
        throw new Error("room not found");
      }

      const [participantRows, newestHistory] = await Promise.all([
        db
          .select()
          .from(schema.participants)
          .where(eq(schema.participants.roomId, args.roomId))
          .orderBy(asc(schema.participants.lineSlot)),
        db
          .select()
          .from(schema.lines)
          .where(eq(schema.lines.roomId, args.roomId))
          .orderBy(desc(schema.lines.lineIdx), desc(schema.lines.createdAt))
          .limit(100),
      ]);
      const historyRows = newestHistory.reverse();

      return {
        roomId: room.id,
        history: historyRows.map((line) => ({
          id: line.id,
          handle: line.handle,
          content: line.content,
          lineIdx: line.lineIdx,
          committed: line.committed,
          committedAt: line.createdAt.getTime(),
          color: (line as any).color,
        })),
        participants: participantRows.map((participant) => ({
          id: participant.id,
          handle: participant.handle,
          color: participant.color,
          lineSlot: participant.lineSlot,
          activeLineIdx: participant.activeLineIdx,
          activeContent: participant.activeContent,
          joinedAt: participant.joinedAt.getTime(),
        })),
        roster: participantRows.map((participant) => ({
          handle: participant.handle,
          color: participant.color,
          lineSlot: participant.lineSlot,
        })),
      };
    },
  }),
} satisfies ActionsModule;
