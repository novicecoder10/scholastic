import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export const SESSION_COOKIE = "scholastic_sid";

/** A distinct address per run, so a rerun never collides with an account the
 * previous run created and left behind. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

export const PASSWORD = "correct-horse-battery-staple";

export async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Test Person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.waitForURL("**/library", { timeout: 20_000 });
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/library/, { timeout: 20_000 });
}

export async function signOutViaMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible({ timeout: 20_000 });
}

export async function anonymousSessionCookie(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies();
  return cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null;
}

/** Uploads the committed fixture PDF through the real endpoint, returning the
 * new document id. Goes through the drop zone rather than the API so the test
 * exercises the same path a user does. */
export async function uploadFixture(page: Page): Promise<string> {
  await page.goto("/reader");
  await page.setInputFiles("input[type=file]", "src/test/fixtures/sample-paper.pdf");
  await page.waitForURL(/\/reader\/.+/, { timeout: 30_000 });
  return page.url().split("/reader/")[1];
}

export async function jsonStatus(request: APIRequestContext, url: string): Promise<number> {
  return (await request.get(url)).status();
}
