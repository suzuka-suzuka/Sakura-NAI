import { DEFAULT_CONNECTION, type ConnectionConfig } from "./nai/client";

export type ConnectionOptions = { sakuraUrl: string | null };
export type ConnectionSource = "official" | "sakura" | "custom";
export type ConnectionDraft = {
  source: ConnectionSource;
  tokens: Record<ConnectionSource, string>;
  customHost: string;
};

function normalizedHost(host: string): string {
  try { return new URL(host.trim()).href.replace(/\/+$/, ""); }
  catch { return host.trim(); }
}

export function connectionSource(host: string, options: ConnectionOptions): ConnectionSource {
  if (normalizedHost(host) === normalizedHost(DEFAULT_CONNECTION.host)) return "official";
  if (options.sakuraUrl && normalizedHost(host) === normalizedHost(options.sakuraUrl)) return "sakura";
  return "custom";
}

export function createConnectionDraft(saved: ConnectionConfig | null, options: ConnectionOptions): ConnectionDraft {
  const source = saved ? connectionSource(saved.host, options) : options.sakuraUrl ? "sakura" : "official";
  const tokens = { official: "", sakura: "", custom: "" };
  if (saved) tokens[source] = saved.token;
  return { source, tokens, customHost: source === "custom" ? saved!.host : "" };
}

export function connectionDraftHost(draft: ConnectionDraft, options: ConnectionOptions): string {
  if (draft.source === "official") return DEFAULT_CONNECTION.host;
  if (draft.source === "sakura") return options.sakuraUrl ?? "";
  return draft.customHost.trim();
}

export function connectionFromDraft(
  draft: ConnectionDraft,
  options: ConnectionOptions,
  retry: Pick<ConnectionConfig, "maxRetries" | "baseDelay">,
): ConnectionConfig {
  return { ...retry, host: connectionDraftHost(draft, options), token: draft.tokens[draft.source].trim() };
}
