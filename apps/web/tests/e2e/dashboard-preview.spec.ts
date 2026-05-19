import { expect, test, type Page } from "@playwright/test";

const firstPreviewName = /open enlarged view: synteq dashboard risk overview preview/i;

async function openFirstDashboardPreview(page: Page) {
  await page.goto("/");

  const trigger = page.getByRole("button", { name: firstPreviewName });
  await trigger.scrollIntoViewIfNeeded();
  await expect(trigger).toBeVisible();
  await expect(page.getByTestId("dashboard-preview-affordance-0")).toBeVisible();

  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Dashboard preview detail" })).toBeVisible();

  return trigger;
}

test("dashboard preview modal opens, zoom controls work, and close restores focus", async ({ page }) => {
  const trigger = await openFirstDashboardPreview(page);
  const zoomLevel = page.getByTestId("dashboard-preview-zoom-level");
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  const resetZoom = page.getByRole("button", { name: "Reset zoom" });
  const closeButton = page.getByRole("button", { name: "Close dashboard preview" });

  await expect(closeButton).toBeFocused();
  await expect(zoomLevel).toHaveText("100%");
  await expect(zoomOut).toBeDisabled();
  await expect(resetZoom).toBeDisabled();

  await zoomIn.click();
  await expect(zoomLevel).toHaveText("125%");
  await expect(zoomOut).toBeEnabled();
  await expect(resetZoom).toBeEnabled();

  await zoomOut.click();
  await expect(zoomLevel).toHaveText("100%");

  await zoomIn.click();
  await zoomIn.click();
  await expect(zoomLevel).toHaveText("150%");

  await resetZoom.click();
  await expect(zoomLevel).toHaveText("100%");

  await closeButton.click();
  await expect(page.getByRole("dialog", { name: "Dashboard preview detail" })).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("dashboard preview modal closes with Escape", async ({ page }) => {
  const trigger = await openFirstDashboardPreview(page);

  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog", { name: "Dashboard preview detail" })).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("dashboard preview modal closes from the backdrop", async ({ page }) => {
  const trigger = await openFirstDashboardPreview(page);

  await page.getByTestId("dashboard-preview-backdrop").click({ position: { x: 8, y: 8 } });

  await expect(page.getByRole("dialog", { name: "Dashboard preview detail" })).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});
