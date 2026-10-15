import { build } from "esbuild";
import fs from "node:fs/promises";
await fs.mkdir("dist", { recursive: true });
await fs.mkdir("gas-dist", { recursive: true });
await build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "dist/app.js",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "eof",
});
const js = (await fs.readFile("dist/app.js", "utf8")).replace(
  /<\/script/gi,
  "<\\/script",
);
const css = await fs.readFile("dist/app.css", "utf8");
const html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>출석 — 프로그램 명단 관리</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
await fs.writeFile("dist/index.html", html);
await fs.writeFile("gas-dist/Index.html", html);
const importer = await build({
  entryPoints: ["src/features/import.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "RosterImporter",
  target: "es2020",
  write: false,
});
await fs.writeFile("gas-dist/Importer.html", importer.outputFiles[0].text);
const result = await build({
  entryPoints: ["server/gas.ts"],
  bundle: true,
  format: "iife",
  globalName: "RosterServer",
  target: "es2020",
  write: false,
});
await fs.writeFile(
  "gas-dist/Code.js",
  `${result.outputFiles[0].text}\nfunction doGet(e){return RosterServer.doGet(e);}\nfunction api(req){return RosterServer.api(req);}\nfunction setup(){return RosterServer.setup();}\n`,
);
await fs.writeFile(
  "gas-dist/appsscript.json",
  JSON.stringify(
    {
      timeZone: "Asia/Seoul",
      runtimeVersion: "V8",
      exceptionLogging: "STACKDRIVER",
      oauthScopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/documents",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "Built dist/ and gas-dist/ (Apps Script: Code.js, Index.html, Importer.html, appsscript.json)",
);
