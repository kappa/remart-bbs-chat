// One tab per session. A page holds a Web Lock named after its participant
// while the session lasts, so a duplicated tab (which copies sessionStorage)
// finds the lock taken and starts in the lobby like a fresh tab, while a
// reload releases the lock with the old document and resumes. The lock is
// released when the session ends, so the tab can join again under an id the
// server may hand out anew after a restart. Browsers without Web Locks skip
// the check.
export type ReleaseSession = () => void;

export function claimSession(participantId: number): Promise<ReleaseSession | null> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    locks
      .request(`remart-bbs-chat.session.${participantId}`, { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(null); return; }
        // The lock is held until this promise settles.
        return new Promise<void>((release) => resolve(() => release()));
      })
      .catch(() => resolve(() => {}));
  });
}
