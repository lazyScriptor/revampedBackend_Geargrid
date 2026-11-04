import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Route files run as soon as the server imports them, so one bad name stops the whole server starting.
// Nothing else loads them all, so this is what catches that before a deploy.
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../src/routes");
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));

describe("every route file loads", () => {
  it.each(files)("%s", async (file) => {
    const mod = await import(join(dir, file));
    expect(mod.default ?? mod).toBeTruthy();
  });
  it("found the route files", () => {
    expect(files.length).toBeGreaterThan(20);
  });
});
