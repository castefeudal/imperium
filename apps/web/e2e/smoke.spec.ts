import { test, expect } from "@playwright/test";

test("login and see app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
