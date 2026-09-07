import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import {
  AUTH_DISABLED_MESSAGE,
  configuredSocialProviders,
  isAuthEnabled,
  isMailerConfigured,
} from "@/lib/auth/config";
import { verifySession } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Create an account" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  // Accounts are optional like every other dependency here: with no
  // BETTER_AUTH_SECRET the whole feature is off and this page says so rather
  // than rendering a form that cannot work.
  if (!isAuthEnabled()) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16 sm:px-8">
        <h1 className="text-ink text-xl font-semibold">Accounts aren&apos;t enabled</h1>
        <p className="text-muted mt-2 text-sm">{AUTH_DISABLED_MESSAGE}</p>
      </main>
    );
  }

  if (await verifySession()) redirect("/library");

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 sm:px-8">
      <AuthForm
        mode="signup"
        socialProviders={configuredSocialProviders()}
        mailerConfigured={isMailerConfigured()}
      />
    </main>
  );
}
