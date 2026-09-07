/**
 * `server-only` is a build-time marker: importing it from a Client Component is
 * meant to fail the bundle. Under vitest's node environment there is no bundler
 * to enforce that and the package does not resolve, so every test that reaches
 * a module guarded by it fails to import. Aliased to this no-op instead.
 */
export {};
