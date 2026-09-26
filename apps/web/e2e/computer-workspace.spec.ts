import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("the computer workspace opens files and the terminal over the screen", async ({
  page,
}, testInfo) => {
  await signup(page, `workspace-${Date.now()}@rakazo.test`, "password12", "Workspace");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await rpc(page, "computer/boot", { botId });
  // The intro run may still hold the computer; control is granted once it finishes.
  await expect
    .poll(
      () =>
        rpc(page, "computer/takeover", { botId }).then(
          () => true,
          () => false,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  await rpc(page, "computer/uploadFile", {
    botId,
    path: "notes.txt",
    contentBase64: Buffer.from("Quarterly numbers checked.\n").toString("base64"),
  });

  const screenUrl = "https://screen.example/vnc.html";
  await page.route("https://screen.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Test desktop</title><body style='margin:0;background:#3a4a5a'>",
    }),
  );
  await page.route("**/rpc/computer/screenUrl", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: { url: screenUrl } }),
    }),
  );

  await page.getByTitle("Agent computer").click();
  const preview = page.getByTestId("computer-preview");
  await preview.hover();
  await preview.getByTestId("computer-preview-open").click();
  await expect(page.getByRole("button", { name: "Close computer" })).toBeVisible();

  await page.getByRole("button", { name: "Files", exact: true }).click();
  const files = page.getByRole("region", { name: "Files" });
  await files.getByRole("button", { name: /^notes\.txt/ }).click();
  await expect(files.getByText("Quarterly numbers checked.")).toBeVisible();
  await expect(files.getByRole("button", { name: "Download" })).toBeVisible();

  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Terminal" })).toBeVisible();
  await expect(page.getByTestId("computer-terminal")).toBeVisible();
  await captureScreenshot(page, testInfo, "computer-workspace");

  await page.getByRole("button", { name: "Close Files" }).click();
  await expect(files).toBeHidden();
});
