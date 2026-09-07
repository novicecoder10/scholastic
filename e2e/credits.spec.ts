import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

/**
 * The parts of #6 that only exist end to end: the welcome grant firing on
 * sign-up (it runs inside better-auth's response hook, which no unit test
 * reaches), and the free surface staying usable for someone with no account.
 */
test.describe("credits", () => {
  test("a new account starts with a published welcome grant, itemised", async ({ page }) => {
    await signUp(page, uniqueEmail("credits"));
    await page.goto("/credits");

    const main = page.locator("main").last();
    await expect(main.getByText("Balance")).toBeVisible({ timeout: 20_000 });
    // The ledger is canonical, so the grant has to be visible as an event and
    // not only as a number.
    // Exact: the ORCID paragraph also contains the phrase "welcome grant".
    await expect(main.getByText("Welcome grant", { exact: true })).toBeVisible();
  });

  test("the credits page is private and the sponsors page is public", async ({ browser }) => {
    const anonymous = await browser.newContext();
    const page = await anonymous.newPage();

    await page.goto("/credits");
    await expect(page).toHaveURL(/\/login\?next=/);

    // Who donates capacity is public; who spends it is never public.
    await page.goto("/sponsors");
    await expect(page.getByRole("heading", { name: "Sponsors" })).toBeVisible();
    await expect(page.getByText("Balance")).toHaveCount(0);
    await anonymous.close();
  });

  test("checking contributions without a verified ORCID iD is refused, not ignored", async ({
    page,
  }) => {
    await signUp(page, uniqueEmail("orcid"));
    const response = await page.request.post("/api/credits/check-contributions");
    // 503 when ORCID isn't configured on the instance, 400 when it is but the
    // account has no verified iD. Both are refusals with a reason; neither is a
    // silent no-op that looks like "you have no publications".
    expect([400, 503]).toContain(response.status());
    expect((await response.json()).error).toBeTruthy();
  });
});
