import { expect, type Page, test } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("demo-pass-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
}

test("a student follows the next step, learns a topic and takes a test", async ({ page }) => {
  await signIn(page, "student@demo.school");
  await page.getByRole("link", { name: /Start/ }).first().click();
  await expect(page.getByRole("heading", { name: "Hard and soft water" })).toBeVisible();
  await page.getByRole("button", { name: "I've learned this" }).click();
  await expect(page.getByText("Nice work!")).toBeVisible();
  await page.getByRole("link", { name: "Next", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Boiling removes temporary hardness" })).toBeVisible();

  await page.goto("/quiz/1");
  await page.getByRole("button", { name: "Start" }).click();
  for (const answer of ["Calcium and magnesium", "Temporary", "Chlorination"]) {
    await page.getByRole("button", { name: answer }).click();
    const finish = page.getByRole("button", { name: "Finish" });
    if (await finish.isVisible()) await finish.click();
    else await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await expect(page.getByText("Perfect score!")).toBeVisible();
  await page.getByRole("link", { name: "See answers" }).click();
  await expect(page.getByRole("heading", { name: "Your answers" })).toBeVisible();
});

test("a teacher edits the outline in place and can undo an archive", async ({ page }) => {
  await signIn(page, "teacher@demo.school");
  await page.goto("/courses/1");
  await page.getByPlaceholder("Add a topic…").first().fill("Rainwater harvesting");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Rainwater harvesting", exact: true })).toBeVisible();
  const row = page.locator(".topic-row", { hasText: "Rainwater harvesting" });
  await row.getByTitle("Archive").click();
  await expect(page.getByText("“Rainwater harvesting” archived.")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("link", { name: "Rainwater harvesting", exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Unit name: Air/ }).click();
  await page.getByRole("textbox", { name: "Unit name" }).fill("Air and gases");
  await page.keyboard.press("Enter");
  await page.reload();
  await expect(page.getByRole("button", { name: /Unit name: Air and gases/ })).toBeVisible();
});

test("a student turns pasted notes into a course", async ({ page }) => {
  await signIn(page, "student2@demo.school");
  await page.getByRole("link", { name: "New course" }).first().click();
  await page.getByLabel("Course name").fill("My biology notes");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "Paste text instead" }).fill("# Cells\n\nCells are the units of life.\n\n# Tissues\n\nTissues are groups of cells.");
  await page.getByRole("button", { name: "Add text" }).click();
  await page.getByRole("button", { name: "Split by headings" }).click();
  await expect(page.getByRole("heading", { name: "Your topics" })).toBeVisible();
  await page.getByRole("button", { name: /Create 2 topics/ }).click();
  await expect(page.getByRole("heading", { name: "My biology notes" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Tissues/ })).toBeVisible();
});

test("Arabic switches the whole interface to right-to-left and the account keeps it", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await page.getByLabel("البريد الإلكتروني").fill("teacher@demo.school");
  await page.locator('input[type="password"]').fill("demo-pass-1");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("link", { name: "المقررات" }).first()).toBeVisible();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload(); // the language now comes from the account
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
