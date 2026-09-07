import type { user as userTable } from "@/lib/db/schema";

/**
 * The only user shape that ever leaves the server.
 *
 * Explicitly constructed rather than spread-and-omit: a field added to the
 * `user` table later must not appear here by default. The password hash lives
 * on `account`, not `user`, but that is a fact about better-auth's schema
 * today, not a guarantee — so this stays a whitelist.
 */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
}

export function toPublicUser(row: typeof userTable.$inferSelect): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
  };
}
