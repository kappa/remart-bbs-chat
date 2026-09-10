// Wire messages between the browser and server/index.js. See docs/PROTOCOL.md.

export type LiveLine = { participantId: number; handle: string; color: string; slot: number; row: number | null; text: string; caret: number };
export type CommittedLine = { id: string; row: number; text: string; handle: string; color: string; committedAt: number };
export type RosterEntry = { participantId: number; handle: string; color: string; slot: number };
export type CommandName = 'help' | 'leave';
export type ErrorCode = 'unauthorized' | 'unknown-participant' | 'seq-gap' | 'invalid-message';

export type ServerMessage =
  | { type: 'snapshot'; roomId: number; you: { participantId: number; nextSeq: number }; liveLines: LiveLine[]; committed: CommittedLine[]; roster: RosterEntry[] }
  | { type: 'live'; participantId: number; row: number | null; text: string; caret: number; seq: number | null }
  | { type: 'committed'; participantId: number | null; seq: number | null; line: CommittedLine }
  | { type: 'roster'; roster: RosterEntry[] }
  | { type: 'command'; name: CommandName }
  | { type: 'error'; code: ErrorCode; expected?: number };

export type KeyInput =
  | { kind: 'char'; char: string }
  | { kind: 'backspace' }
  | { kind: 'enter' }
  | { kind: 'left' }
  | { kind: 'right' }
  | { kind: 'word-left' }
  | { kind: 'word-right' }
  | { kind: 'home' }
  | { kind: 'end' }
  | { kind: 'delete' };
export type KeyMessage = { type: 'key'; seq: number } & KeyInput;
export type ClientMessage = { type: 'hello'; roomId: number; participantId: number; token: string } | KeyMessage;
