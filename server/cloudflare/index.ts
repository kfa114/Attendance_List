import type {
  DurableObjectNamespace,
  DurableObjectState,
  Fetcher,
} from "@cloudflare/workers-types";
import { Service } from "../service";
import { initialize, SqlRepository, SqlRuntime } from "./storage";
import type { ApiRequest } from "../../src/domain/model";
interface Env {
  WORKSPACE: DurableObjectNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSPHRASE?: string;
}
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const failure = (error: string, status: number, code = "VALIDATION") =>
  new Response(JSON.stringify({ ok: false, error, code }), { status, headers });
async function digest(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}
export class AttendanceWorkspace {
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    initialize(ctx.storage.sql);
  }
  async fetch(request: Request): Promise<Response> {
    if (!this.env.ADMIN_PASSPHRASE || this.env.ADMIN_PASSPHRASE.length < 16)
      return failure(
        "운영자 설정이 필요합니다. Cloudflare Secret에 ADMIN_PASSPHRASE를 16자 이상으로 등록해주세요.",
        503,
        "SETUP",
      );
    try {
      const req = (await request.json()) as ApiRequest;
      let accepted = false;
      if (req.action === "login") {
        const [a, b] = await Promise.all([
          digest(String(req.data?.secret || "")),
          digest(this.env.ADMIN_PASSPHRASE),
        ]);
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
        accepted = diff === 0;
      }
      // All writes and domain decisions below are synchronous. A transaction
      // isolates conflicting sign/save requests and persists sessions across restarts.
      const sql = this.ctx.storage.sql;
      sql.exec("DELETE FROM sessions WHERE expires<=?", Date.now());
      sql.exec("DELETE FROM attempts WHERE expires<=?", Date.now());
      const rt = new SqlRuntime(
        sql,
        new URL(request.url).origin,
        accepted,
        request.headers.get("X-Login-Scope") || "unknown",
      );
      return new Response(
        JSON.stringify(
          new Service(new SqlRepository(this.ctx.storage), rt).handle(req),
        ),
        { headers },
      );
    } catch {
      return failure(
        "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
        500,
        "SERVER",
      );
    }
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (url.pathname !== "/api")
        return failure("지원하지 않는 주소입니다.", 404);
      if (request.method !== "POST")
        return failure("POST 요청만 사용할 수 있습니다.", 405);
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin)
        return failure(
          "다른 사이트의 요청은 허용하지 않습니다.",
          403,
          "FORBIDDEN",
        );
      if (!request.headers.get("Content-Type")?.startsWith("application/json"))
        return failure("JSON 요청이 필요합니다.", 415);
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      const reader = request.body?.getReader();
      if (!reader) return failure("요청 내용이 없습니다.", 400);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 4_000_000) {
          await reader.cancel();
          return failure("요청 용량이 너무 큽니다.", 413);
        }
        chunks.push(value);
      }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      try {
        const req = JSON.parse(new TextDecoder().decode(body));
        if (
          !req ||
          typeof req.action !== "string" ||
          req.action.length > 60 ||
          (req.token &&
            (typeof req.token !== "string" || req.token.length > 512)) ||
          (req.data &&
            (typeof req.data !== "object" || Array.isArray(req.data)))
        )
          return failure("요청 형식을 확인해주세요.", 400);
      } catch {
        return failure("JSON 형식을 확인해주세요.", 400);
      }
      const scope = await digest(
        request.headers.get("CF-Connecting-IP") || "local",
      );
      const scopedHeaders = new Headers({
        "Content-Type": "application/json",
        "X-Login-Scope": Array.from(scope)
          .map((v) => v.toString(16).padStart(2, "0"))
          .join(""),
      });
      const stub = env.WORKSPACE.get(
        env.WORKSPACE.idFromName("attendance-workspace-v1"),
      );
      // The namespace name is fixed: callers cannot select another database.
      return stub.fetch(
        new Request(request.url, {
          method: "POST",
          headers: scopedHeaders,
          body,
        }) as any,
      ) as unknown as Promise<Response>;
    }
    return env.ASSETS.fetch(request as any) as unknown as Promise<Response>;
  },
};
