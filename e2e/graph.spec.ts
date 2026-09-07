import { expect, test } from "@playwright/test";

/**
 * The parts of #9 that only exist in a browser: the canvas mounting at all, the
 * accessible fallback that stands in for it, and the coverage caveat being
 * visible rather than buried in a doc.
 */
test.describe("citation graph explorer", () => {
  test("offers a way in rather than rendering an empty canvas with no seed", async ({ page }) => {
    // Reaching this page from the navbar used to land on an explainer with
    // nothing to click, which is a dead end wearing a nav item.
    await page.goto("/graph");
    await expect(page.getByRole("heading", { name: "Citation map" })).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);

    await page.getByLabel("Map the literature on").fill("mitochondrial dysfunction");
    await page.getByRole("button", { name: "Build map" }).click();
    await expect(page).toHaveURL(/\/graph\?.*q=mitochondrial\+dysfunction/);
  });

  test("seeds from a result set and labels every metric as subgraph-local", async ({ page }) => {
    test.slow();
    await page.goto("/graph?from=search&q=mitochondrial+dysfunction");
    await page.waitForSelector("canvas", { timeout: 120_000 });

    // Citation coverage is incomplete and biased, so none of these numbers is
    // presented as a property of the literature.
    await expect(page.getByText("within the loaded subgraph")).toBeVisible();
    await expect(page.getByText(/\d+ \/ \d+ nodes/)).toBeVisible();
  });

  test("renders the graph as real DOM for anyone who cannot see a canvas", async ({ page }) => {
    test.slow();
    await page.goto("/graph?from=search&q=mitochondrial+dysfunction");
    await page.waitForSelector("canvas", { timeout: 120_000 });

    const fallback = page.locator("details").filter({ hasText: "Papers and citations as a list" });
    await expect(fallback).toHaveCount(1);
    await fallback.locator("summary").click();

    // Selecting from the list drives the same inspector the canvas does.
    await fallback.locator("li button").first().click();
    await expect(page.getByText(/in this graph|starting paper/).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("a result set links into the explorer", async ({ page }) => {
    test.slow();
    await page.goto("/?q=mitochondrial+dysfunction");
    await page.waitForSelector("article", { timeout: 90_000 });
    const link = page.getByRole("link", { name: /See these as a citation graph/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /\/graph\?from=search/);
  });
});
