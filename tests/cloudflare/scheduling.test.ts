import test from "node:test";
import assert from "node:assert/strict";
import worker from "../../server/cloudflare/index";
test("예약 작업은 고정 워크스페이스의 비공개 정리를 호출하고 실패를 전파", async () => {
  let path = "",
    name = "";
  const stub = {
    fetch: async (request: Request) => {
      path = new URL(request.url).pathname;
      assert.equal(request.method, "POST");
      return new Response("ok");
    },
  };
  const env = {
    WORKSPACE: {
      idFromName: (n: string) => {
        name = n;
        return "id";
      },
      get: () => stub,
    },
  } as any;
  await worker.scheduled({} as any, env);
  assert.equal(name, "attendance-workspace-v1");
  assert.equal(path, "/__maintenance/trash");
  stub.fetch = async () => new Response("error", { status: 500 });
  await assert.rejects(() => worker.scheduled({} as any, env));
});
