import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | Promise<never>;

/** Replaces global fetch with a router keyed by path prefix. Returns the recorded calls. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => path.startsWith(k));
    if (!key) return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "no mock" } }), { status: 404 });
    const result = routes[key]!(path, init);
    if (result instanceof Promise) return result;
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

export const ok = <T,>(data: T) => ({ body: { ok: true, data } });
export const never = () => new Promise<never>(() => {});

export function renderAt(path: string, element: ReactElement, routePath = "*") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}
