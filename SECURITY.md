# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/novicecoder10/scholastic/security/advisories/new)
rather than opening a public issue.

Include what you did, what happened, and what you expected. A proof of concept helps; a working
exploit is not required and is not expected in the initial report.

## Scope notes specific to this project

**Credentials.** No API key is ever stored in the database — `capacity_source.credential_ref`
holds the _name_ of an environment variable, and the secret lives in the environment. If you find
any path that writes a credential to the database, to a log line, or to a response body, that is
a vulnerability in this project regardless of how it got there.

**Ownership checks.** Every user-owned resource is scoped in the SQL `WHERE` clause rather than
checked after the read, and a resource that is not yours returns **404, not 403** — a 403 confirms
the record exists, which is exactly what a capability URL must not leak. A route that returns 403
for someone else's object is a bug worth reporting.

**Self-hosted deployments.** This is software you run yourself. `SESSION_SECRET` and
`BETTER_AUTH_SECRET` must be set to real random values in any deployment reachable by anyone
other than you; see [`SETUP.md`](./SETUP.md).
