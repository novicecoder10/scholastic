"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth. `baseURL` is deliberately unset so it uses the current
 * origin — the app is self-hostable at any domain and hardcoding one would
 * break every deployment but the first.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
