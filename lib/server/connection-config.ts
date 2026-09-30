import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ConnectionOptions } from "../connection-options";

export function parseConnectionOptions(value: unknown): ConnectionOptions {
  const config = value as { sakura?: { url?: unknown } } | null;
  if (typeof config?.sakura?.url !== "string" || !config.sakura.url.trim()) {
    throw new Error("connection.config.json requires sakura.url");
  }
  const url = new URL(config.sakura.url.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("sakura.url must be an HTTP(S) URL without credentials, query parameters or fragments");
  }
  return { sakuraUrl: url.href };
}

/** Read at request time: changing the file takes effect on the next page refresh. */
export async function loadConnectionOptions(
  configPath = process.env.SAKURA_CONFIG_FILE || resolve(process.cwd(), "connection.config.json"),
): Promise<ConnectionOptions> {
  try { return parseConnectionOptions(JSON.parse(await readFile(configPath, "utf8"))); }
  catch {
    console.error("Sakura connection configuration is missing or invalid. Check connection.config.json.");
    return { sakuraUrl: null };
  }
}
