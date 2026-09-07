import { expect, test } from "@playwright/test";

/**
 * The deck builder's contract, checked without spending a credit: the page
 * states what it will and will not do, shows the cost before the button that
 * spends it, and refuses to run on nothing.
 *
 * Generating a real deck is deliberately not exercised here — it runs a
 * nine-provider search and the most expensive single generation in the app, and
 * an end-to-end suite that spends donated capacity on every run is a suite
 * nobody can afford to keep green.
 */
test.describe("presentation builder", () => {
  test("says what it builds before it builds anything", async ({ page }) => {
    await page.goto("/present");
    await expect(page.getByRole("heading", { name: "Presentation" })).toBeVisible();
    await expect(
      page.getByText("Bullets that come back without a citation are deleted before you see them"),
    ).toBeVisible();
  });

  test("shows the cost next to the control that spends it", async ({ page }) => {
    await page.goto("/present");
    await expect(page.getByText(/~\d+ credits/)).toBeVisible();
  });

  test("cannot be run on an empty topic", async ({ page }) => {
    await page.goto("/present");
    await expect(page.getByRole("button", { name: "Build deck" })).toBeDisabled();
    await page.getByLabel("What is the talk about?").fill("sleep deprivation");
    await expect(page.getByRole("button", { name: "Build deck" })).toBeEnabled();
  });

  test("carries a topic in from the homepage quick action", async ({ page }) => {
    await page.goto("/present?q=CRISPR+off-target+effects");
    await expect(page.getByLabel("What is the talk about?")).toHaveValue(
      "CRISPR off-target effects",
    );
  });
});
