import { parseAccount, type AccountInfo } from "./cost";

export class AccountQueryError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

/** A successful HTTP response alone is not proof: a proxy may return its HTML homepage. */
export async function queryAccount(cfg: { host: string; token: string }): Promise<AccountInfo> {
  let endpoint: string;
  try {
    const base = new URL(cfg.host.trim());
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
    endpoint = `${base.href.replace(/\/+$/, "")}/user/subscription`;
  } catch {
    throw new AccountQueryError("Enter a valid HTTP or HTTPS host URL without query parameters.");
  }
  try {
    // Do not retry or follow redirects while checking credentials. Use exactly the configured host.
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000), cache: "no-store", redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const message = response.status === 401 ? "Access key is invalid or disabled."
        : response.status === 403 ? "Connection forbidden. Check the server's allowed origins and access permissions."
        : [404, 405, 501].includes(response.status) ? "This server does not support account verification."
        : response.status === 429 ? "The server is busy. Try again shortly."
        : response.status >= 500 ? "The service is unavailable. Try again later."
        : "The server rejected the account query.";
      throw new AccountQueryError(message, response.status);
    }
    try { return parseAccount(await response.json()); }
    catch (error) {
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw error;
      throw new AccountQueryError("The server returned invalid account data. Check the host URL.");
    }
  } catch (error) {
    if (error instanceof AccountQueryError) throw error;
    throw new AccountQueryError(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
      ? "Connection timed out. Try again."
      : "Cannot reach the server. Check the address, network and allowed origins.");
  }
}
