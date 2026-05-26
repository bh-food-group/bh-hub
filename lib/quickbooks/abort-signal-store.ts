import { AsyncLocalStorage } from 'async_hooks';

/** Holds the current request AbortSignal for QB fetch calls. */
export const qbAbortStore = new AsyncLocalStorage<AbortSignal | undefined>();
