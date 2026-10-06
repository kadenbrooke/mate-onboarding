import '@testing-library/jest-dom';

// Node >= 25 defines its own Web Storage getters (localStorage, sessionStorage)
// on globalThis, and they return undefined unless node runs with
// --localstorage-file. vitest's jsdom environment does not overwrite globals
// Node already defines, so window.localStorage was Node's undefined instead of
// jsdom's Storage. Re-point both at the jsdom window's real Storage objects.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      get: () => dom.window[key],
    });
  }
}
