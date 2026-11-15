import { expect, test } from "@playwright/test";
import { PRODUCT_NAME } from "@/app/brand";
import { HOME_TEXT } from "@/app/uploadFlow";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: HOME_TEXT.headline }),
  ).toBeVisible();
});

test("home page carries the product name in the tab and the brand", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(PRODUCT_NAME);
  await expect(page.getByText(PRODUCT_NAME, { exact: true })).toBeVisible();
});
