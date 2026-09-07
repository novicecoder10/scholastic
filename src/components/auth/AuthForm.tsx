"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { signIn, signUp } from "@/lib/auth/client";

type Mode = "login" | "signup";

/**
 * One form for both modes. They differ by a name field, a call, and their
 * copy — forking the component would duplicate the error handling and the
 * `next` redirect logic, which is where the bugs would be.
 */
export function AuthForm({
  mode,
  socialProviders,
  mailerConfigured,
}: {
  mode: Mode;
  socialProviders: Array<"github" | "google">;
  mailerConfigured: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Only a same-origin path is honoured, so a crafted ?next= can't turn the
  // sign-in page into an open redirect.
  const raw = searchParams.get("next") ?? "/library";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/library";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result =
      mode === "signup"
        ? await signUp.email({ name: name.trim() || email, email, password })
        : await signIn.email({ email, password });
    setPending(false);

    if (result.error) {
      setError(result.error.message ?? "That didn't work. Check your details and try again.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  const heading = mode === "signup" ? "Create an account" : "Sign in";

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">{heading}</h1>
      <p className="text-muted mt-1 text-sm">
        {mode === "signup" ? "Your uploaded papers move across with you." : "Welcome back."}
      </p>

      {socialProviders.length > 0 && (
        <div className="mt-6 space-y-2">
          {socialProviders.map((provider) => (
            <button
              key={provider}
              type="button"
              onClick={() => void signIn.social({ provider, callbackURL: next })}
              className="border-line text-ink hover:border-line-strong w-full rounded-xl border px-4 py-2 text-sm font-medium capitalize transition-colors"
            >
              Continue with {provider}
            </button>
          ))}
          <p className="text-muted text-center text-xs">or</p>
        </div>
      )}

      <form onSubmit={submit} className="mt-4 space-y-3">
        {mode === "signup" && (
          <Field label="Name" value={name} onChange={setName} type="text" autoComplete="name" />
        )}
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
        />

        {error && (
          <p className="text-danger text-sm" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="bg-accent-solid text-accent-ink hover:bg-accent-solid-hover w-full rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {pending ? "…" : heading}
        </button>
      </form>

      <p className="text-muted mt-4 text-sm">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-link hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            No account?{" "}
            <Link href="/signup" className="text-link hover:underline">
              Create one
            </Link>
          </>
        )}
      </p>

      {!mailerConfigured && mode === "login" && (
        <p className="text-muted mt-3 text-xs">
          Password reset isn&apos;t available on this instance — no mail server is configured.
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type: string;
  autoComplete: string;
  required?: boolean;
}) {
  const id = `auth-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="text-muted mb-1 block text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="border-line bg-page text-ink focus-visible:border-accent w-full rounded-xl border px-3 py-2 text-sm outline-none"
      />
    </div>
  );
}
