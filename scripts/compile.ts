// Build the single binary at dist/devmailbox with the built dashboard (web/dist) embedded.
// Run `vite build web` first (`just compile` does).

import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dist = join(root, "web", "dist");
const outfile = process.argv[2] ?? join(root, "dist", "devmailbox");

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });

let assets: string[];
try {
  assets = files(dist);
} catch {
  console.error("web/dist is missing: run `bunx vite build web` first");
  process.exit(1);
}

// Each built file becomes an import with { type: "file" }, which embeds it unchanged.
const generated = [
  ...assets.map((p, i) => `import f${i} from ${JSON.stringify(p)} with { type: "file" };`),
  "export const WEB_ASSETS: Record<string, string> | null = {",
  ...assets.map((p, i) => `  ${JSON.stringify(`/${relative(dist, p).split("\\").join("/")}`)}: f${i},`),
  "};",
].join("\n");

const result = await Bun.build({
  entrypoints: [join(root, "server", "main.ts")],
  compile: { outfile },
  minify: true,
  sourcemap: "linked",
  plugins: [
    {
      name: "embed-web",
      setup(build) {
        build.onLoad({ filter: /[\\/]server[\\/]web-assets\.ts$/ }, () => ({
          contents: generated,
          loader: "ts",
        }));
      },
    },
  ],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`${outfile} (${assets.length} dashboard files embedded)`);
