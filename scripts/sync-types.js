// Copies Herdr's generated API declarations into types/, so type-checking works in CI
// (Herdr writes them into ~/.config/herdr-app on start; they're not on npm).
// Run after a Herdr update: npm run sync-types
import { copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const home = process.env.HERDR_APP_HOME ?? join(homedir(), ".config", "herdr-app");
for (const file of ["herdr.d.ts", "gpui-kit.d.ts"]) {
  await copyFile(join(home, file), new URL(`../types/${file}`, import.meta.url));
  console.log(`types/${file} ← ${join(home, file)}`);
}
