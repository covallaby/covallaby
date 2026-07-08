import { beforeAll, describe, expect, it } from "vitest";
import { createApp, ensureUploadToken } from "../src/app.js";
import { SqliteStore } from "../src/store/sqlite.js";

const lcov = `SF:src/a.ts
DA:1,5
DA:2,0
DA:3,5
end_of_record
`;

const store = new SqliteStore(":memory:");
const app = createApp({ store, uploadToken: "sekret" });

const upload = (query = "repo=acme/app&branch=main&commit=abc1234", token = "sekret") =>
  app.request(`/api/v1/upload?${query}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: lcov,
  });

describe("upload API", () => {
  it("rejects bad tokens and bad repos", async () => {
    expect((await upload(undefined, "wrong")).status).toBe(401);
    expect((await upload("repo=nope")).status).toBe(400);
  });

  it("accepts a coverage file and computes the summary", async () => {
    const res = await upload();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.percent).toBeCloseTo(66.66, 1);
    expect(json.url).toBe(`/r/acme/app/u/${json.id}`);
  });

  it("gives a friendly 422 for unparseable bodies", async () => {
    const res = await app.request("/api/v1/upload?repo=acme/app", {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
      body: "not a coverage file",
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("lcov");
  });
});

describe("read API and badge", () => {
  beforeAll(async () => {
    await upload("repo=acme/app&branch=main&commit=def5678");
  });

  it("lists repos with trends", async () => {
    const json = await (await app.request("/api/v1/repos")).json();
    const repo = json.repos.find((r: { repo: string }) => r.repo === "acme/app");
    expect(repo.latest.commit).toBe("def5678");
    expect(repo.trend.length).toBeGreaterThanOrEqual(2);
  });

  it("serves history with branches", async () => {
    const json = await (await app.request("/api/v1/repos/acme/app/history")).json();
    expect(json.branch).toBe("main");
    expect(json.branches).toContain("main");
    expect(json.history[0].commit).toBe("def5678");
  });

  it("serves upload detail with directories and files", async () => {
    const repos = await (await app.request("/api/v1/repos")).json();
    const id = repos.repos[0].latest.id;
    const json = await (await app.request(`/api/v1/uploads/${id}`)).json();
    expect(json.totals.lines.covered).toBe(2);
    expect(json.directories[0].path).toBe("src");
    expect(json.files[0].path).toBe("src/a.ts");
    expect(json.files[0].missing).toBe("2");
  });

  it("serves a live badge", async () => {
    const res = await app.request("/badge/acme/app.svg");
    expect(res.headers.get("content-type")).toContain("svg");
    expect(await res.text()).toContain("66.6%");
  });

  it("404s unknown repos and uploads", async () => {
    expect((await app.request("/api/v1/repos/acme/nope/history")).status).toBe(404);
    expect((await app.request("/api/v1/uploads/99999")).status).toBe(404);
  });

  it("always answers dashboard routes: SPA when built, a pointer when not", async () => {
    const res = await app.request("/r/acme/app");
    expect(res.status).toBe(200);

    const unbuilt = createApp({ store, uploadToken: "sekret", webDist: "/nonexistent" });
    expect(await (await unbuilt.request("/r/acme/app")).text()).toContain("dashboard isn't built");
  });
});

describe("view token gate", () => {
  const gated = createApp({ store, uploadToken: "sekret", viewToken: "peek" });

  it("blocks pages without the token but allows health and upload", async () => {
    expect((await gated.request("/")).status).toBe(401);
    expect((await gated.request("/?token=peek")).status).toBe(200);
    expect((await gated.request("/healthz")).status).toBe(200);
  });
});

describe("ensureUploadToken", () => {
  it("prefers the env token, else generates and persists one", async () => {
    const s = new SqliteStore(":memory:");
    expect(await ensureUploadToken(s, "from-env")).toBe("from-env");
    const generated = await ensureUploadToken(s, undefined);
    expect(generated.length).toBeGreaterThan(20);
    expect(await ensureUploadToken(s, undefined)).toBe(generated); // stable across boots
    await s.close();
  });
});
