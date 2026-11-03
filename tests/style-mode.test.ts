import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";

test("style apply mode survives closing, applying, importing and reloading, in both directions", async t => {
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries({
    window: {},
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    indexedDB: new IDBFactory(),
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { toast } = await import("sonner");
  t.mock.method(toast, "dismiss", () => "test");
  // Import after setting up window so the real browser persistence subscription runs.
  const { useStore } = await import("../lib/store");
  const { loadUIPrefs } = await import("../lib/nai/client");
  const { DEFAULT_SETTINGS } = await import("../lib/nai/types");
  const { Model } = await import("../lib/nai/protocol");
  const { createStylePreset, applyStylePreset } = await import("../lib/style-presets");
  const { prepareStyleImport } = await import("../lib/style-import");
  const ref = { base64: "AQID", preview: "", strength: 0.6, informationExtracted: 1 };
  const current = { ...DEFAULT_SETTINGS, model: Model.V4_5, prompt: "old prompt", negativePrompt: "old negative", vibe: [ref] };
  const incoming = { ...current, prompt: "new prompt", negativePrompt: "new negative", vibe: [{ ...ref, strength: 0.9 }] };
  const prompt = createStylePreset("prompt", "prompt", incoming);
  const vibe = createStylePreset("vibe", "vibe", incoming);
  assert.equal(useStore.getState().styleAppend, true);

  for (const append of [false, true]) {
    useStore.getState().setUI({ showStyleLibrary: true, styleAppend: append });
    useStore.getState().setUI({ showStyleLibrary: false, styleImport: null });
    useStore.getState().setUI({ showStyleLibrary: true });
    assert.equal(useStore.getState().styleAppend, append);

    const applied = applyStylePreset(current, prompt, useStore.getState().styleAppend);
    assert.equal(applied.prompt, append ? "old prompt, new prompt" : "new prompt");
    assert.equal(applied.negativePrompt, append ? "old negative, new negative" : "new negative");
    const appliedVibe = applyStylePreset(current, vibe, useStore.getState().styleAppend);
    assert.deepEqual(appliedVibe.vibe, append ? [...current.vibe, ...incoming.vibe] : incoming.vibe);
    useStore.getState().restoreSettings(applied);
    useStore.getState().setUI({ showStyleLibrary: false, styleImport: null });
    assert.equal(await prepareStyleImport([new File(["imported prompt"], "style.txt")]), true);
    assert.equal(useStore.getState().styleAppend, append);

    // Exercise the actual debounced write, then restore through the app's init path.
    t.mock.timers.tick(450);
    assert.equal(loadUIPrefs()?.styleAppend, append);
    useStore.setState(useStore.getInitialState(), true);
    await useStore.getState().init();
    assert.equal(useStore.getState().styleAppend, append);
    useStore.getState().setUI({ showConnect: false });
  }
});
