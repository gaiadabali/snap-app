// Stands in for the `server-only` package under vitest.
//
// `server-only`'s real module unconditionally throws — it relies on Next's
// webpack/Turbopack config to alias it to a genuine no-op ONLY when bundling
// for the server, and to leave the throwing version in place for a client
// bundle. Vitest does not apply that bundler-specific substitution, so
// without this alias every file in this app that starts with
// `import 'server-only'` (which is most of `src/lib/`, deliberately) would
// throw the instant it was imported in a test — nothing to do with whether
// the code under test is actually correct.
export {};
