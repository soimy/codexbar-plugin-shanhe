import { readFile } from "node:fs/promises";
const source = await readFile(new URL("./shanhe.js", import.meta.url), "utf8");
if (!source.includes("defineProvider({") || !source.includes('id: "shanhe"')) throw new Error("provider manifest missing");
const fixture = JSON.parse(await readFile(new URL("./fixtures/usage.json", import.meta.url)));
if (fixture.usage.used !== 250 || fixture.usage.limit !== 1000) throw new Error("fixture mismatch");
console.log("shanhe plugin syntax and fixture checks passed");
