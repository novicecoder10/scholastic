## What this changes

<!-- and why. Link an issue if there is one. -->

## Checks

- [ ] `pnpm lint`
- [ ] `pnpm exec tsc --noEmit`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm test:e2e` (if the UI changed)

## Project rules

- [ ] No generated claim is displayed without a citation the caller supplied.
- [ ] No credential is written to the database, a log line, or a response body.
- [ ] Documentation updated (`CHANGELOG.md`, and `KNOWN_LIMITATIONS.md` if this adds a trade-off).
