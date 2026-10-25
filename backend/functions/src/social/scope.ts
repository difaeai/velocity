/**
 * Which workspace the code running right now belongs to.
 *
 * The AsyncLocalStorage behind `workspace.ts`, on its own so that leaf modules
 * (the AI meter, the key store) can ask without importing the desk — which
 * imports the engine, which imports them.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { Brand } from '../studio/plans';

export const HOUSE = 'velocity';

export interface Scope {
  wid: string;
  brand: Brand | null;
}

export const scope = new AsyncLocalStorage<Scope>();

export const currentWorkspace = (): string => scope.getStore()?.wid ?? HOUSE;
export const isHouse = (): boolean => currentWorkspace() === HOUSE;
/** The customer's brand; null in the house, whose brand is written into the prompts. */
export const workspaceBrand = (): Brand | null => scope.getStore()?.brand ?? null;
