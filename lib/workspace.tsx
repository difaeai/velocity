'use client';

/**
 * Whose desk the console is showing.
 *
 * A Velocity admin sees Velocity's own desk, whose documents sit at the root as
 * they always have. A Velocity Studio customer sees their workspace, whose
 * documents sit under `workspaces/{id}/` in the same shapes — so every desk page
 * reads through `path()` and works for both. Mirrors `wsPath` in the backend.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { useAuth } from './auth';
import { db } from './firebase';
import { planIncludes, studioCanUse, type StudioNeed, type StudioWorkspace } from './studio';

interface WorkspaceState {
  /** Null for Velocity's own desk. */
  wid: string | null;
  house: boolean;
  /** The customer's workspace document; null in the house or while loading. */
  ws: StudioWorkspace | null;
  /** A desk path for this console: unchanged in the house, under the workspace otherwise. */
  path: (p: string) => string;
  /** Whether the plan includes this part (live or not). The house has everything. */
  includes: (need: StudioNeed) => boolean;
  /** Whether it may be used right now (trial or paid month running). */
  live: (need: StudioNeed) => boolean;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { workspaceId } = useAuth();
  const [ws, setWs] = useState<StudioWorkspace | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return onSnapshot(
      doc(db, 'workspaces', workspaceId),
      (snap) => setWs(snap.exists() ? (snap.data() as StudioWorkspace) : null),
      () => setWs(null),
    );
  }, [workspaceId]);

  // Stable per workspace, so a page's subscriptions do not reopen each time the workspace doc changes.
  const path = useCallback((p: string) => (workspaceId ? `workspaces/${workspaceId}/${p}` : p), [workspaceId]);

  const value = useMemo<WorkspaceState>(() => {
    const house = !workspaceId;
    return {
      wid: workspaceId,
      house,
      ws: house ? null : ws,
      path,
      includes: (need) => house || (ws ? planIncludes(ws.plan, need) : false),
      live: (need) => house || (ws ? studioCanUse(ws, need, Date.now()) : false),
    };
  }, [workspaceId, ws, path]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}
