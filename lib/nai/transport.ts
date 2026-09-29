import { decode } from "@msgpack/msgpack";
import JSZip from "jszip";
import { EventType, Image, type MsgpackEvent, type GenerationPayload } from "./protocol";

type Connection = { host: string; token: string; maxRetries: number; baseDelay: number };
const TIMEOUT = 120_000;

export class NaiTransport {
  constructor(private readonly config: Connection) {}
  async request(path: string, body?: unknown, signal?: AbortSignal, accept = "application/zip, application/json"): Promise<Response> {
    const cfg = this.config;
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT);
    for (let attempt = 0;; attempt++) {
      const response = await fetch(`${cfg.host.replace(/\/+$/, "")}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${cfg.token}`, Accept: accept, ...(body === undefined || body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: requestSignal,
      });
      if (response.ok) return response;
      // Only retry explicit rejection before generation starts. Network failures, 5xx,
      // and partial streams may already represent a billed job and are never replayed.
      if (response.status === 429 && attempt < Math.min(10, Math.max(0, cfg.maxRetries))) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Math.min(60000, Math.max(cfg.baseDelay * 2 ** attempt, retryAfter * 1000));
        await response.body?.cancel();
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(requestSignal.reason); };
          const timer = setTimeout(() => { requestSignal.removeEventListener("abort", abort); resolve(); }, delay);
          requestSignal.addEventListener("abort", abort, { once: true });
          if (requestSignal.aborted) abort();
        });
        continue;
      }
      const detail = (await response.text()).slice(0, 800).replaceAll(cfg.token, "[redacted]");
      throw new Error(`NovelAI HTTP ${response.status}: ${detail}`);
    }
  }
  async images(path: string, body: unknown, signal?: AbortSignal) {
    return decodeImages(await this.request(path, body, signal));
  }
  async *generate(payload: GenerationPayload, streaming: boolean, signal?: AbortSignal): AsyncGenerator<MsgpackEvent> {
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    try {
      if (!streaming) {
        const images = await this.images("/ai/generate-image", payload, combined);
        if (images.length !== Number(payload.parameters.n_samples)) throw new Error("Unexpected number of generated images");
        for (const [samp_ix, image] of images.entries()) yield { event_type: EventType.FINAL, samp_ix, step_ix: Number(payload.parameters.steps), image };
        return;
      }
      const response = await this.request("/ai/generate-image-stream", payload, combined, "application/x-msgpack, text/event-stream");
      yield* decodeStream(response, Number(payload.parameters.n_samples));
    } finally { controller.abort(); }
  }
}

export async function decodeImages(response: Response): Promise<Image[]> {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const result = await response.json() as { images?: { image: string; index?: number }[] };
    if (!Array.isArray(result.images) || !result.images.length || result.images.some(i => !i.image)) throw new Error("No images in server response");
    return [...result.images].sort((a,b) => (a.index ?? 0) - (b.index ?? 0)).map(i => new Image(i.image));
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (type.startsWith("image/")) {
    if (!bytes.length) throw new Error("Empty image response");
    return [new Image(bytes)];
  }
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && /\.(png|webp|jpe?g)$/i.test(n)).sort((a,b) => a.localeCompare(b, "en", { numeric: true }));
  if (!names.length) throw new Error("No images in server archive");
  return Promise.all(names.map(async n => {
    const image = await zip.files[n].async("uint8array");
    if (!image.length) throw new Error(`Empty image in server archive: ${n}`);
    return new Image(image);
  }));
}

function eventFrom(value: unknown): MsgpackEvent | null {
  if (!value || typeof value !== "object") throw new Error("Invalid generation event");
  const e = value as Record<string, unknown>;
  if (e.event_type === "error" || e.error) throw new Error(`NovelAI stream: ${String(e.message ?? e.error ?? "generation failed")}`);
  if (e.event_type !== EventType.FINAL && e.event_type !== EventType.INTERMEDIATE) return null;
  const data = e.image;
  if (!(typeof data === "string" || data instanceof Uint8Array || Array.isArray(data))) throw new Error("Generation event has no image");
  const image = new Image(Array.isArray(data) ? new Uint8Array(data) : data);
  if (!image.data.length) throw new Error("Generation event has an empty image");
  return { event_type: e.event_type, samp_ix: Number(e.samp_ix), step_ix: Number(e.step_ix ?? 0), image };
}

/** Accept arbitrary network chunk boundaries; check complete frames and final sample count. */
export async function* decodeStream(response: Response, count: number): AsyncGenerator<MsgpackEvent> {
  if (!response.body) throw new Error("The generation response has no body.");
  const reader = response.body.getReader();
  const sse = response.headers.get("content-type")?.includes("text/event-stream");
  let buffer = new Uint8Array(0), text = "";
  const decoder = new TextDecoder(), finals = new Set<number>();
  const check = (value: unknown) => {
    const event = eventFrom(value);
    if (!event) return null;
    if (!Number.isInteger(event.samp_ix) || event.samp_ix < 0 || event.samp_ix >= count) throw new Error("The server returned an invalid image index.");
    if (finals.has(event.samp_ix)) return null;
    if (event.event_type === EventType.FINAL) finals.add(event.samp_ix);
    return event;
  };
  const parseSSE = (record: string) => {
    const lines = record.split(/\r?\n/);
    const kind = lines.find(l => l.startsWith("event:"))?.slice(6).trim();
    const data = lines.filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
    if (kind === "error") throw new Error(`NovelAI stream: ${data}`);
    if (!data || data === "[DONE]") return null;
    const parsed = JSON.parse(data);
    return check({ ...parsed, event_type: parsed.event_type ?? kind });
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (sse) {
        text += decoder.decode(value, { stream: true });
        let match: RegExpExecArray | null;
        while ((match = /\r?\n\r?\n/.exec(text))) {
          const event = parseSSE(text.slice(0, match.index));
          text = text.slice(match.index + match[0].length);
          if (event) yield event;
        }
        if (text.length > 64 * 1024 * 1024) throw new Error("Generation event is too large");
      } else {
        const joined = new Uint8Array(buffer.length + value.length); joined.set(buffer); joined.set(value, buffer.length); buffer = joined;
        while (buffer.length >= 4) {
          const length = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0);
          if (!length || length > 64 * 1024 * 1024) throw new Error("Invalid MessagePack frame length");
          if (buffer.length < length + 4) break;
          const event = check(decode(buffer.subarray(4, length + 4)));
          buffer = buffer.slice(length + 4);
          if (event) yield event;
        }
      }
    }
    if (sse) { text += decoder.decode(); if (text.trim()) { const event = parseSSE(text); if (event) yield event; } }
    else if (buffer.length) throw new Error("Truncated MessagePack frame");
    if (finals.size !== count) throw new Error("The stream ended before all final images arrived.");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
