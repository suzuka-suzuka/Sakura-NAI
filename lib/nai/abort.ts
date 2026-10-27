// Keep cancellation usable in browsers without AbortSignal.any/timeout/throwIfAborted.
const reasons = new WeakMap<AbortSignal, unknown>();

export function abortReason(signal: AbortSignal): unknown {
  if (reasons.has(signal)) return reasons.get(signal);
  return signal.reason === undefined ? new DOMException("The operation was aborted.", "AbortError") : signal.reason;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

/** Own the signal until the response body is consumed, then dispose it in finally. */
export function createAbortScope(signals: (AbortSignal | undefined)[], timeoutMs: number) {
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    listeners.clear();
  };
  const abort = (reason: unknown = new DOMException("The operation was aborted.", "AbortError")) => {
    cleanup();
    if (controller.signal.aborted) return;
    // Older AbortControllers ignore abort(reason) and do not expose signal.reason.
    reasons.set(controller.signal, reason);
    controller.abort(reason);
  };
  for (const signal of signals) {
    if (!signal || listeners.has(signal)) continue;
    if (signal.aborted) { abort(abortReason(signal)); break; }
    const listener = () => abort(abortReason(signal));
    listeners.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }
  if (!controller.signal.aborted) {
    timer = setTimeout(() => abort(new DOMException("The request timed out.", "TimeoutError")), timeoutMs);
  }
  return { signal: controller.signal, dispose: () => abort() };
}
