import { setupServer } from "msw/node";

// Individual test files register their own handlers via `server.use(...)`.
// No default handlers here — an unhandled request should fail the test loudly
// rather than silently hitting the real network.
export const server = setupServer();
