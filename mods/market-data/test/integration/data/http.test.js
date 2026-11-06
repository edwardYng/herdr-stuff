import { describe, expect, it } from "vitest";
import { errorLabel, getJson, HttpError, UA } from "../../../src/data/http.js";
import { fakeFetch } from "./fakes.js";

describe("getJson", () => {
  it("parses a 2xx body and passes headers through", async () => {
    const fetch = fakeFetch([["x", { json: { a: 1 } }]]);
    expect(await getJson(fetch, "https://x/", { "User-Agent": UA })).toEqual({ a: 1 });
    expect(fetch.calls[0]).toEqual({ url: "https://x/", options: { headers: { "User-Agent": UA } } });
  });

  it("sends no options without headers", async () => {
    const fetch = fakeFetch([["x", { json: [] }]]);
    await getJson(fetch, "https://x/");
    expect(fetch.calls[0].options).toBeUndefined();
  });

  it.each([400, 404, 429, 500, 503])("throws HttpError with status %i", async (status) => {
    const fetch = fakeFetch([["x", { status, body: "nope" }]]);
    const e = await getJson(fetch, "https://x/").catch((err) => err);
    expect(e).toBeInstanceOf(HttpError);
    expect(e).toMatchObject({ status, message: String(status), url: "https://x/", name: "HttpError" });
  });

  it("lets a network failure through as it is", async () => {
    const boom = new Error("connection refused");
    const fetch = fakeFetch([["x", { error: boom }]]);
    await expect(getJson(fetch, "https://x/")).rejects.toBe(boom);
  });
});

describe("HttpError", () => {
  it("says offline for status 0 and takes a custom message", () => {
    expect(new HttpError(0).message).toBe("offline");
    expect(new HttpError(404, "u", "not found")).toMatchObject({ status: 404, message: "not found" });
  });
});

describe("errorLabel", () => {
  it("maps 4xx to not found and everything else to offline", () => {
    expect(errorLabel(new HttpError(404))).toBe("not found");
    expect(errorLabel(new HttpError(400))).toBe("not found");
    expect(errorLabel(new HttpError(500))).toBe("offline");
    expect(errorLabel(new HttpError(0))).toBe("offline");
    expect(errorLabel(new Error("no data"))).toBe("offline");
    expect(errorLabel("weird")).toBe("offline");
  });
});
