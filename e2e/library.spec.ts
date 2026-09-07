import { expect, test } from "@playwright/test";
import { signIn, signOutViaMenu, signUp, uniqueEmail } from "./helpers";

/**
 * One account for every test that only needs "some signed-in user".
 *
 * Not just tidiness: sign-in and sign-up are rate limited at 20/minute per
 * address (see lib/auth/config.ts), and a suite that signs up once per test
 * from 127.0.0.1 races that limit rather than the code. Tests that genuinely
 * need a second identity still create one.
 */
const shared = { email: uniqueEmail("library-shared"), created: false };

async function useSharedAccount(page: import("@playwright/test").Page) {
  if (!shared.created) {
    await signUp(page, shared.email);
    shared.created = true;
    return;
  }
  await signIn(page, shared.email);
}

test.describe("library", () => {
  test("library API answers 401 JSON when signed out, while pages redirect", async ({
    page,
    request,
  }) => {
    // Three surfaces, three deliberately different answers.
    const api = await request.get("/api/library/items");
    expect(api.status()).toBe(401);
    expect((await api.json()).error).toBeTruthy();

    await page.goto("/library/collections/does-not-exist");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("saving a paper puts it in the library and unsaving removes it", async ({ page }) => {
    // The results page fans out to nine providers before it renders; the
    // default 30s budget is spent before the test has clicked anything.
    test.slow();
    await useSharedAccount(page);

    await page.goto("/?q=mitochondrial+dysfunction");
    // Scoped to the first card: TopicsPanel also renders aria-pressed buttons.
    const save = page.locator("article").first().locator("button[aria-pressed]").first();
    await expect(save).toBeVisible({ timeout: 30_000 });

    // Results stream in, so the button is clickable in the DOM before React has
    // hydrated that boundary and a click lands on nothing. Retrying the click
    // is safe because it is guarded on the current aria-pressed state: the
    // toggle only fires while the paper is unsaved.
    await expect(async () => {
      if ((await save.getAttribute("aria-pressed")) === "false") await save.click();
      await expect(save).toHaveAttribute("aria-pressed", "true", { timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await expect(save).toHaveText("Saved ✓");

    await page.goto("/library");
    await expect(page.getByRole("tab", { name: /Papers 1/ })).toBeVisible({ timeout: 20_000 });

    await page.goto("/?q=mitochondrial+dysfunction");
    const unsave = page.locator("article").first().locator("button[aria-pressed]").first();
    await expect(unsave).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await expect(async () => {
      if ((await unsave.getAttribute("aria-pressed")) === "true") await unsave.click();
      await expect(unsave).toHaveAttribute("aria-pressed", "false", { timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
  });

  test("one user cannot open another user's collection", async ({ browser }) => {
    const ownerEmail = uniqueEmail("owner");
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signUp(ownerPage, ownerEmail);
    await ownerPage.goto("/library");
    await ownerPage.getByRole("tab", { name: /Collections/ }).click();
    await ownerPage.getByRole("button", { name: "New collection" }).click();
    await ownerPage.getByLabel("Collection name").fill("Private reading");
    await ownerPage.getByRole("button", { name: "Create" }).click();
    await expect(ownerPage.getByText("Private reading")).toBeVisible({ timeout: 20_000 });
    await ownerPage.getByText("Private reading").click();
    await ownerPage.waitForURL(/\/library\/collections\/.+/);
    const url = ownerPage.url();
    await ownerContext.close();

    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await signUp(otherPage, uniqueEmail("other"));
    await otherPage.goto(url);
    // Indistinguishable from a collection that doesn't exist.
    await expect(otherPage.getByText("This page could not be found.")).toBeVisible();
    await otherContext.close();
  });

  test("a duplicate collection name is refused with a message, not a crash", async ({ page }) => {
    await useSharedAccount(page);
    await page.goto("/library");
    await page.getByRole("tab", { name: /Collections/ }).click();

    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole("button", { name: "New collection" }).click();
      await page.getByLabel("Collection name").fill("Duplicate probe");
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForTimeout(700);
    }
    // Scoped to main: Next renders its own empty [role=alert] route announcer
    // in the document, which makes a bare getByRole("alert") ambiguous.
    await expect(page.locator("main [role=alert]")).toContainText("already have a collection");
  });

  test("an anonymous visitor sees the library, not a redirect", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
  });

  test("a signed-in user's library survives sign-out and sign-in", async ({ page }) => {
    await useSharedAccount(page);
    await page.goto("/library");
    await page.getByRole("tab", { name: /Collections/ }).click();
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByLabel("Collection name").fill("Durable");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Durable")).toBeVisible();

    await signOutViaMenu(page);
    await signIn(page, shared.email);
    await page.getByRole("tab", { name: /Collections/ }).click();
    await expect(page.getByText("Durable")).toBeVisible();
  });
});
