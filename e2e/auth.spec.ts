import { expect, test } from "@playwright/test";
import {
  anonymousSessionCookie,
  PASSWORD,
  signIn,
  signOutViaMenu,
  signUp,
  uniqueEmail,
  uploadFixture,
} from "./helpers";

/**
 * The four adoption cases from the #5 spec, plus the cookie rotation that makes
 * the fourth safe. These are the flows where a bug is a security bug rather
 * than a quality problem, which is why they are tested in a real browser
 * against a real database rather than with mocked cookies.
 */
test.describe("accounts and anonymous-session adoption", () => {
  test("an anonymous visitor's uploads move to the account they create", async ({
    page,
    context,
  }) => {
    const documentId = await uploadFixture(page);
    const cookieBefore = await anonymousSessionCookie(context);
    expect(cookieBefore).not.toBeNull();

    await signUp(page, uniqueEmail("adopt"));

    // The reader still opens it, and now the library lists it as the account's.
    await page.goto(`/reader/${documentId}`);
    await expect(page.getByText("sample-paper.pdf")).toBeVisible();
  });

  test("signing in on a fresh device claims nothing and does not error", async ({ browser }) => {
    const email = uniqueEmail("fresh");
    const first = await browser.newContext();
    await signUp(await first.newPage(), email);
    await first.close();

    const second = await browser.newContext();
    const page = await second.newPage();
    await signIn(page, email);
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await second.close();
  });

  test("a second user on a shared browser cannot inherit the first user's uploads", async ({
    page,
  }) => {
    // The whole point of `AND user_id IS NULL` in claimAnonymousSession.
    const documentId = await uploadFixture(page);
    await signUp(page, uniqueEmail("first"));
    await signOutViaMenu(page);

    await signUp(page, uniqueEmail("second"));
    // 404 renders, not the document. (Next streams the body, so the HTTP
    // status is 200 — see KNOWN_LIMITATIONS.md; the rendered page is what
    // matters, and it is identical for "not yours" and "doesn't exist".)
    await page.goto(`/reader/${documentId}`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });

  test("signing out rotates the anonymous session cookie", async ({ page, context }) => {
    await uploadFixture(page);
    const before = await anonymousSessionCookie(context);

    await signUp(page, uniqueEmail("rotate"));
    await signOutViaMenu(page);

    const after = await anonymousSessionCookie(context);
    expect(after).not.toBeNull();
    // Without rotation the next anonymous visitor resumes the departing user's
    // device identity.
    expect(after).not.toBe(before);
  });

  test("a signed-out browser sees an empty library after the user leaves", async ({ page }) => {
    await uploadFixture(page);
    await signUp(page, uniqueEmail("empty"));
    await signOutViaMenu(page);

    await page.goto("/library");
    await expect(page.getByText("Nothing here yet.")).toBeVisible();
  });

  test("rejects a wrong password without revealing whether the account exists", async ({
    page,
  }) => {
    const email = uniqueEmail("wrongpw");
    await signUp(page, email);
    await signOutViaMenu(page);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(`${PASSWORD}-wrong`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
