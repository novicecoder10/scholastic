"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/auth/client";

/** Replaces the placeholder "—" circle the redesign left in the nav. */
export function AccountMenu({
  email,
  name,
  authEnabled,
}: {
  email: string | null;
  name: string | null;
  authEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (!authEnabled) {
    return (
      <span
        aria-hidden="true"
        title="Accounts aren't enabled on this instance"
        className="border-line bg-surface-2 text-muted ml-1 h-7 w-7 rounded-full border text-center text-xs leading-[26px] font-medium"
      >
        —
      </span>
    );
  }

  if (!email) {
    return (
      <Link
        href="/login"
        className="border-line text-muted hover:border-accent hover:text-accent ml-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
      >
        Sign in
      </Link>
    );
  }

  const initial = (name?.trim() || email)[0]?.toUpperCase() ?? "?";

  return (
    <div ref={containerRef} className="relative ml-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Account menu"
        className="border-line bg-surface-2 text-ink h-7 w-7 rounded-full border text-center text-xs leading-[26px] font-medium"
      >
        {initial}
      </button>
      {open && (
        <div className="border-line bg-surface absolute top-full right-0 z-30 mt-2 w-56 rounded-xl border p-2 shadow-lg">
          <p className="text-muted truncate px-2 py-1 text-xs">{email}</p>
          <Link
            href="/library"
            onClick={() => setOpen(false)}
            className="text-ink hover:bg-surface-2 block rounded-lg px-2 py-1.5 text-sm transition-colors"
          >
            Library
          </Link>
          <Link
            href="/credits"
            onClick={() => setOpen(false)}
            className="text-ink hover:bg-surface-2 block rounded-lg px-2 py-1.5 text-sm transition-colors"
          >
            Credits
          </Link>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              setOpen(false);
              // Sign-out rotates scholastic_sid server-side, so a refresh is
              // required for the page to stop showing the previous identity.
              router.push("/");
              router.refresh();
            }}
            className="text-ink hover:bg-surface-2 block w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
