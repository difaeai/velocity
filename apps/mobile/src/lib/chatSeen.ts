/**
 * "The last time I looked at this conversation", per room.
 *
 * Every chat in this app lives in a different collection — trip chat under
 * `trips/{id}/chat`, Travel Partner DMs under `travelMateMatches/{id}/messages`,
 * group chat under `travelMateGroups/{id}/messages` — and none of them carries a
 * per-user read cursor. The server does not need one: it pushes on send and the
 * open screen streams. The Messages inbox does need one, because "is there
 * something here I haven't read" is the only question it exists to answer.
 *
 * So the cursor is local: one timestamp per room in AsyncStorage. That is the
 * right storage for it — a read receipt is a property of the handset you read it
 * on, it must survive a reload, and nothing else in the system depends on it.
 *
 * The in-memory cache on top is what makes the badge honest. Without it, opening
 * a chat would clear the row only after the next mount: AsyncStorage is async and
 * nothing re-renders when it lands. Here a mark is visible to every subscriber in
 * the same tick and is persisted behind it.
 *
 * The `trip` prefix is deliberately the key useUnreadChat has always written, so
 * opening a ride's chat from the trip screen clears it in the inbox too.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useSyncExternalStore } from 'react';

/** Which conversation family a room id belongs to. Keys never collide. */
export type ChatKind = 'trip' | 'mate' | 'group';

const PREFIX: Record<ChatKind, string> = {
  trip:  'velocity.chatSeen.',
  mate:  'velocity.mateSeen.',
  group: 'velocity.groupSeen.',
};

const PREFIXES = Object.values(PREFIX);

const cache = new Map<string, number>();
const listeners = new Set<() => void>();

/** Bumped on every change so useSyncExternalStore has something to compare. */
let version = 0;
let hydrated = false;
let hydrating: Promise<void> | null = null;

function keyOf(kind: ChatKind, id: string): string {
  return PREFIX[kind] + id;
}

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Pull every stored cursor into memory once per app session.
 *
 * One multiGet rather than a read per row: the inbox asks about every
 * conversation at once, and a per-row await would render the whole list as
 * unread for a frame and then correct itself.
 */
async function hydrate(): Promise<void> {
  if (hydrated) return;
  if (!hydrating) {
    hydrating = (async () => {
      try {
        const keys = (await AsyncStorage.getAllKeys()).filter((k) =>
          PREFIXES.some((p) => k.startsWith(p)),
        );
        if (keys.length > 0) {
          for (const [k, v] of await AsyncStorage.multiGet(keys)) {
            const at = Number(v);
            if (at > 0) cache.set(k, at);
          }
        }
      } catch {
        // No stored cursors we can reach. Everything reads as unseen, which is
        // the safe direction: a badge that shouldn't be there beats a message
        // nobody is told about.
      }
      hydrated = true;
      emit();
    })();
  }
  return hydrating;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  void hydrate();
  return () => { listeners.delete(cb); };
}

function snapshot(): number {
  return version;
}

/** Cursor for one room, in epoch ms. 0 = never opened (or not hydrated yet). */
export function seenAt(kind: ChatKind, id: string): number {
  return cache.get(keyOf(kind, id)) ?? 0;
}

/** Whether the cursors have been read off disk. Until then, nothing is unread. */
export function seenReady(): boolean {
  return hydrated;
}

/**
 * Record that this room has been looked at.
 *
 * Idempotent and monotonic: marking an older moment than the one already stored
 * does nothing, so a late-arriving mark can never resurrect a cleared badge.
 */
export function markChatSeen(kind: ChatKind, id: string, at: number = Date.now()): void {
  if (!id) return;
  const key = keyOf(kind, id);
  if ((cache.get(key) ?? 0) >= at) return;
  cache.set(key, at);
  emit();
  AsyncStorage.setItem(key, String(at)).catch(() => {});
}

/**
 * Re-render this component whenever any cursor moves.
 *
 * The returned `seenAt` is a fresh function per version, not the module one.
 * That is the point: an unread count derived in a useMemo has to recompute when
 * a chat is opened, and a reader that depends on a never-changing function would
 * simply keep showing the badge it computed before.
 *
 * `ready` lets a list hold its badges back for the one frame before the cursors
 * come off disk, rather than flashing every conversation as new.
 */
export function useChatSeen(): { seenAt: typeof seenAt; ready: boolean } {
  const version = useSyncExternalStore(subscribe, snapshot, snapshot);
  const pinned = useCallback(
    (kind: ChatKind, id: string) => seenAt(kind, id),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity tracks the store
    [version],
  );
  return { seenAt: pinned, ready: hydrated };
}
