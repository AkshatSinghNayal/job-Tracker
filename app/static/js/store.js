// store.js — tiny observable store for cross-view state.
const listeners = new Set();

export const store = {
  user: null,                 // { username }
  activeConnectionId: 'app',  // 'app' = APP_DB workspace, else a saved connection id
  connections: [],
  applications: [],
};

export function setState(patch) {
  Object.assign(store, patch);
  for (const fn of listeners) fn(store);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'];
