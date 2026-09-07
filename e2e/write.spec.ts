import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

/**
 * The claim that justifies choosing ProseMirror over a markdown box: a citation
 * is an object holding only a workKey, so labels are derived and a style switch
 * is a re-render rather than a rewrite. That is verifiable in a browser and
 * nowhere else.
 */
test.describe("manuscript editor", () => {
  test("the editor is account-gated, and says why rather than redirecting", async ({ page }) => {
    await page.goto("/write");
    await expect(page.getByRole("heading", { name: "Write" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
    // A manuscript tied to a browser session would vanish with a cleared
    // cookie, so this is the one feature that refuses anonymous ownership.
    await expect(page).toHaveURL(/\/write$/);
  });

  test("citations are objects: labels derive, and a style switch rewrites nothing", async ({
    page,
  }) => {
    test.slow();
    await signUp(page, uniqueEmail("writer"));

    await page.goto("/?q=mitochondrial+dysfunction");
    await page.waitForSelector("article", { timeout: 60_000 });
    for (const index of [0, 1]) {
      const save = page.locator("article").nth(index).locator("button[aria-pressed]").first();
      await expect(async () => {
        if ((await save.getAttribute("aria-pressed")) === "false") await save.click();
        await expect(save).toHaveAttribute("aria-pressed", "true", { timeout: 3_000 });
      }).toPass({ timeout: 40_000 });
    }

    await page.goto("/write");
    await page.getByRole("button", { name: "New manuscript" }).click();
    await page.getByLabel("Manuscript title").fill("Citation objects");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/\/write\/.+/, { timeout: 30_000 });

    await page.locator(".manuscript-prose").click();
    await page.keyboard.type("A claim. ");
    await page.locator("aside section").first().locator("li button").first().click();

    const chip = page.locator(".citation-chip").first();
    await expect(chip).toBeVisible({ timeout: 20_000 });
    // APA: author and year, derived from the document — never stored.
    await expect(chip).toHaveText(/\(\w+.*, \d{4}\)/, { timeout: 20_000 });

    await page.getByLabel("Style").selectOption("mla");
    // MLA cites author and page; a bibliography has no page, so the year goes.
    await expect(chip).toHaveText(/^\([^,]+\)$/, { timeout: 20_000 });

    // The bibliography is derived from the same nodes.
    await expect(page.locator("aside ol li")).toHaveCount(1);
  });

  test("every export is available with no model configured", async ({ page }) => {
    test.slow();
    await signUp(page, uniqueEmail("exporter"));
    await page.goto("/write");
    await page.getByRole("button", { name: "New manuscript" }).click();
    await page.getByLabel("Manuscript title").fill("Export shapes");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/\/write\/.+/, { timeout: 30_000 });

    const api = page.url().replace("/write/", "/api/manuscripts/");
    // Fetched from inside the page: the session cookie is Secure under a
    // production build, and Playwright's request context drops it over http.
    const markdown = await page.evaluate(
      async (url: string) => (await fetch(url)).text(),
      `${api}/export?format=markdown`,
    );
    expect(markdown).toContain("# Export shapes");
    expect(markdown).toContain("## References");
  });
});
