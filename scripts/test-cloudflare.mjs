import assert from "node:assert/strict";
const base = process.env.LOCAL_CF_URL || "http://localhost:8787";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "This smoke test is restricted to localhost.",
);
async function call(action, data = {}, token = "") {
  const r = await fetch(`${base}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data, token }),
  });
  return r.json();
}
function ok(r) {
  assert.equal(r.ok, true, r.error);
  return r.data;
}
const anonymous = await call("bootstrap");
assert.equal(anonymous.code, "AUTH");
const admin = ok(await call("login", { secret: "local-preview-admin" })).token;
const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const p = ok(
  await call(
    "createProgram",
    {
      title: "Cloudflare 자동 검증 명단",
      signatureEnabled: false,
      dates: [date],
      participants: [
        {
          name: "가상 참여자",
          phone: "01000009001",
          note: "실제 개인정보 아님",
        },
      ],
    },
    admin,
  ),
);
const bundle = ok(await call("getBundle", { programId: p.id }, admin));
assert.equal(bundle.participants.length, 1);
assert.equal(ok(await call("bootstrap", {}, admin)).mode, "cloudflare");
const tablet = ok(await call("tabletSession", { programId: p.id }, admin));
assert.ok(tablet.url.startsWith(base));
const student = ok(
  await call("studentLogin", { programId: p.id, last4: "9001" }),
);
const safe = ok(await call("getBundle", { programId: p.id }, student.token));
assert.equal(safe.participants[0].phone, "");
assert.equal(safe.participants[0].note, "");
const version = ok(
  await call("createExport", { programId: p.id, date }, admin),
);
const exported = ok(
  await call(
    "downloadExport",
    { programId: p.id, exportId: version.id },
    admin,
  ),
);
assert.equal(exported.format, "attendance-snapshot");
assert.equal(exported.snapshot.rows[0].singleMode, true);
let next = ok(
  await call(
    "setProgramStatus",
    { programId: p.id, revision: p.revision, status: "archived" },
    admin,
  ),
);
assert.equal(
  (await call("getBundle", { programId: p.id }, tablet.token)).ok,
  false,
);
next = ok(
  await call(
    "setProgramStatus",
    { programId: p.id, revision: next.revision, status: "deleted" },
    admin,
  ),
);
assert.equal(
  (await call("getBundle", { programId: p.id }, admin)).code,
  "NOT_FOUND",
);
next = ok(
  await call(
    "setProgramStatus",
    { programId: p.id, revision: next.revision, status: "active" },
    admin,
  ),
);
assert.equal(
  ok(await call("getBundle", { programId: p.id }, admin)).exports.length,
  1,
);
ok(
  await call(
    "setProgramStatus",
    { programId: p.id, revision: next.revision, status: "deleted" },
    admin,
  ),
);
assert.equal(
  (
    await fetch(`${base}/api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://unrelated.example",
      },
      body: "{}",
    })
  ).status,
  403,
);
assert.equal(
  (
    await fetch(`${base}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    })
  ).status,
  400,
);
assert.equal(
  (
    await fetch(`${base}/api`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    })
  ).status,
  415,
);
const assets = await Promise.all(
  ["/", "/fonts/NanumGothic-Regular.ttf"].map((p) => fetch(base + p)),
);
assert.ok(assets.every((r) => r.ok));
console.log(
  "Cloudflare smoke test passed: auth, SQLite persistence, private scopes, tablet URL, export snapshots, archive/trash/restore, origin and request validation, static assets.",
);
