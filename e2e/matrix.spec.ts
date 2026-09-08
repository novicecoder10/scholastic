import { expect, test } from "@playwright/test";
import { uploadFixture } from "./helpers";

/**
 * The deterministic half of #7. Filling cells needs a live model and real
 * credits, so what is asserted here is ownership, the shape of the grid, and
 * the export — the parts that must hold whether or not a provider answers.
 */
test.describe("evidence matrix", () => {
  test("a matrix holds a paper and a field, and exports with provenance columns", async ({
    page,
  }) => {
    test.slow();
    await uploadFixture(page);

    await page.goto("/matrix");
    await page.getByRole("button", { name: "New matrix" }).click();
    await page.getByLabel("Matrix title").fill("Sleep and memory");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/\/matrix\/.+/, { timeout: 30_000 });
    const url = page.url();

    await page.getByLabel("Add a field").fill("sample size");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("columnheader", { name: /sample size/ })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByLabel("Add a paper").selectOption({ index: 1 });
    await expect(page.getByRole("cell", { name: /sample-paper/ })).toBeVisible({
      timeout: 20_000,
    });

    // Every value column is exported with its page and its quote. A CSV of
    // bare numbers extracted by a model is the artefact that must not exist.
    //
    // Fetched from inside the page rather than via `page.request`: the
    // anonymous session cookie is `Secure` under a production build, and
    // Playwright's APIRequestContext drops it over plain http where the browser
    // keeps it. Through `page.request` this endpoint answers 404 for its own
    // owner, which looks exactly like the bug it would be if it were real.
    const csv = await page.evaluate(
      async (target: string) => {
        const response = await fetch(target);
        return { status: response.status, body: await response.text() };
      },
      `${url.replace("/matrix/", "/api/matrix/")}/export`,
    );
    expect(csv.status).toBe(200);
    const header = csv.body.split("\r\n")[0];
    expect(header).toContain("sample size");
    expect(header).toContain("sample size — page");
    expect(header).toContain("sample size — quote");
  });

  test("one browser cannot open another's matrix", async ({ page, browser }) => {
    await page.goto("/matrix");
    await page.getByRole("button", { name: "New matrix" }).click();
    await page.getByLabel("Matrix title").fill("Private review");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/\/matrix\/.+/, { timeout: 30_000 });
    const url = page.url();

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(url);
    // Indistinguishable from a matrix that does not exist.
    await expect(otherPage.getByText("This page could not be found.")).toBeVisible();
    await other.close();
  });

  test("a fill is priced before it runs", async ({ page }) => {
    test.slow();
    await uploadFixture(page);
    await page.goto("/matrix");
    await page.getByRole("button", { name: "New matrix" }).click();
    await page.getByLabel("Matrix title").fill("Priced run");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/\/matrix\/.+/, { timeout: 30_000 });

    await page.getByLabel("Add a field").fill("study design");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Add a paper").selectOption({ index: 1 });
    await expect(page.getByRole("cell", { name: /sample-paper/ })).toBeVisible({
      timeout: 20_000,
    });

    // #6's rule: the cost of an expensive action is shown before it runs. The
    // dialog is dismissed, so nothing is spent and nothing is filled.
    const message = new Promise<string>((resolve) => {
      page.once("dialog", (dialog) => {
        void dialog.dismiss();
        resolve(dialog.message());
      });
    });
    await page.getByRole("button", { name: /Fill empty cells/ }).click();
    expect(await message).toMatch(/Fill 1 cell\? This costs about \d+ credits\./);
  });
});
