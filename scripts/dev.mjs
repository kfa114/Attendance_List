import { build } from "esbuild";
import { createServer } from "vite";
import path from "node:path";
await build({
  entryPoints: ["server/service.ts", "server/local.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: ".local/server",
  packages: "external",
});
const { Service } = await import(path.resolve(".local/server/service.js"));
const { LocalRepository, LocalRuntime } = await import(
  path.resolve(".local/server/local.js")
);
const service = new Service(
  new LocalRepository(".local/data.json"),
  new LocalRuntime(
    ".local/files",
    process.env.LOCAL_ADMIN_SECRET || "local-preview-admin",
  ),
);
const server = await createServer({
  // The importer is loaded on demand through a computed URL. Include its
  // dependencies up front so the first upload never triggers a Vite reload.
  optimizeDeps: {
    include: ["react/jsx-dev-runtime", "xlsx", "xlsx/dist/cpexcel.full.mjs"],
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  plugins: [
    {
      name: "local-apps-script-api",
      configureServer(vite) {
        vite.middlewares.use("/api", (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            return res.end();
          }
          let body = "";
          req.on("data", (c) => {
            body += c;
            if (body.length > 4_000_000) req.destroy();
          });
          req.on("end", () => {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            try {
              res.end(JSON.stringify(service.handle(JSON.parse(body))));
            } catch {
              res.statusCode = 400;
              res.end(
                JSON.stringify({
                  ok: false,
                  error: "요청 형식을 확인해주세요.",
                }),
              );
            }
          });
        });
      },
    },
  ],
});
await server.listen();
server.printUrls();
