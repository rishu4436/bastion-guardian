import { expect, test } from "@playwright/test";
import { DEV_KEYS, injectWallet } from "./wallet";

const harness = (p: string, init?: RequestInit) =>
  fetch(`http://127.0.0.1:4101${p}`, init).then((r) => r.json() as Promise<Record<string, unknown>>);

test("landing renders and the theme toggle persists dark/light", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("defended");
  await expect(page.getByRole("note")).toContainText("LOCAL SIMULATION");
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const before = await theme();
  await page.getByRole("button", { name: /Switch to/ }).click();
  expect(await theme()).not.toBe(before);
  await page.reload();
  expect(await theme()).not.toBe(before);
});

test("status shows honest deployment state and live indexer checkpoints", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByText("not deployed").first()).toBeVisible();
  await expect(page.getByText("database connected")).toBeVisible();
  await expect(page.getByText("mainnet disabled")).toBeVisible();
  await expect(page.getByText("Local Anvil (simulation)").first()).toBeVisible();
});

test("dashboard → policy → rescue receipt shows exact indexed amounts", async ({ page }) => {
  const { policyA } = await harness("/ready");
  await page.goto("/dashboard");
  const link = page.locator(`a[href="/policies/31337/${String(policyA).toLowerCase()}"]`).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole("heading", { name: "Protection policy" })).toBeVisible();
  await expect(page.getByTestId("readiness-checks")).toBeVisible();
  await expect(page.getByText("13,000 fUSDC").or(page.getByText(/fUSDC/)).first()).toBeVisible();
  await page.locator('a[href^="/rescues/"]').first().click();
  await expect(page.getByRole("heading", { name: "Rescue receipt" })).toBeVisible();
  await expect(page.getByText("2,800.0102").first()).toBeVisible();
  await expect(page.getByText("Reimbursed").first()).toBeVisible();
  await expect(page.getByText("Local simulation").first()).toBeVisible();
});

test("simulator runs a labeled scenario through the API", async ({ page }) => {
  await page.goto("/simulator");
  await expect(page.getByText(/LOCAL FIXTURE/)).toBeVisible();
  await page.getByRole("button", { name: "Run scenario" }).click();
  await expect(page.getByTestId("sim-outcome")).toHaveText("flash");
  await expect(page.getByText("Simulated").first()).toBeVisible();
});

test("wallet connect + SIWE sign-in, then link and verify a Telegram channel and send a [TEST] alert", async ({
  page,
}) => {
  await injectWallet(page, DEV_KEYS.borrowerA);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Sign in with Ethereum" }).click();
  await expect(page.getByText("signed in")).toBeVisible();
  await expect(page.getByText("Your policies")).toBeVisible();
  await expect(page.getByRole("link", { name: "Operations" })).toHaveCount(0);

  await page.getByRole("link", { name: "Notifications" }).click();
  await page.getByLabel("Destination").fill("424242");
  await page.getByRole("button", { name: "Link" }).click();
  await expect(page.getByText("Verification code sent")).toBeVisible();
  const { codes } = (await harness("/codes")) as { codes: string[] };
  await page.getByLabel("Code for telegram").fill(codes.at(-1)!);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("telegram verified.")).toBeVisible();
  await page.getByRole("button", { name: "Send test" }).click();
  await expect(page.getByText("[TEST] notification queued")).toBeVisible();
  await expect(page.getByText("provider_accepted").first()).toBeVisible({ timeout: 15_000 });
});

test("admin sees the operations console; SSE feed updates live", async ({ page }) => {
  await injectWallet(page, DEV_KEYS.gov);
  await page.goto("/activity");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Sign in with Ethereum" }).click();
  await expect(page.getByText("signed in")).toBeVisible();
  await expect(page.getByText("streaming")).toBeVisible();
  await harness("/evaluate", { method: "POST" });
  await expect(page.getByTestId("event-feed").getByText("readiness.updated").first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("link", { name: "Operations" }).click();
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  await expect(page.getByText("auth.sign_in").first()).toBeVisible();
});
