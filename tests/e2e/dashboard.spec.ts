import { createPrivateKey, sign } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv } from "../../playwright.config";
import { E2E } from "./global-setup";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E.alice);
  await page.getByLabel("Password").fill(E2E.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function sendInteraction(payload: unknown) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = createPrivateKey(process.env.E2E_PRIVATE_KEY as string);
  const signature = sign(null, Buffer.from(timestamp + body), key).toString("hex");
  return fetch(`${e2eEnv.APP_URL}/api/discord/interactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
    },
    body,
  });
}

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto(`/dashboard/${E2E.guildId}`);
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("a wrong password shows an error and stays on the login page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E.alice);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a report sent to the endpoint shows up in the live log", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /Night Owls/ }).click();
  await expect(page.getByText("No activity yet")).toBeVisible();

  const res = await sendInteraction({
    id: String(BigInt(Date.now()) << 22n),
    application_id: e2eEnv.DISCORD_APPLICATION_ID,
    type: 2,
    token: "e2e-token",
    guild_id: E2E.guildId,
    channel_id: "300000000000000001",
    member: { user: { id: "400000000000000001", username: "carol" }, permissions: "0" },
    data: {
      name: "report",
      options: [{ name: "details", type: 3, value: "Voice keeps dropping" }],
    },
  });
  expect(res.status).toBe(200);

  // No reload: the log polls on its own.
  await expect(page.getByText("#1 Voice keeps dropping")).toBeVisible({ timeout: 10_000 });
});

test("rule changes are validated, saved and persist", async ({ page }) => {
  await signIn(page);
  await page.goto(`/dashboard/${E2E.guildId}/rules`);

  await page.getByLabel("Role to ping").fill("moderators");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText(/17 to 20 digit number/)).toBeVisible();

  await page.getByLabel("Role to ping").fill("900000000000000001");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("/report rules saved")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Role to ping")).toHaveValue("900000000000000001");
});

test("another admin's server is indistinguishable from a missing one", async ({ page }) => {
  await signIn(page);
  const res = await page.goto(`/dashboard/${E2E.otherGuildId}`);
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Nothing here")).toBeVisible();
  await expect(page.getByText("Someone Else")).toHaveCount(0);
});
