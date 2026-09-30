"use client";

import { translateUI, useLocale } from "@/lib/i18n";
import { LanguageSwitch } from "./language-switch";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { useStore } from "@/lib/store";
import { DEFAULT_CONNECTION } from "@/lib/nai/client";
import { connectionDraftHost, connectionFromDraft, createConnectionDraft, type ConnectionOptions, type ConnectionSource } from "@/lib/connection-options";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { BrandLogo } from "@/components/brand-logo";

/**
 * Hostname for display. The raw field is echoed back if it isn't a parseable URL — this renders on
 * every keystroke while the user edits Host URL, and a bare `new URL()` would throw on the first
 * incomplete one and take the whole dialog down with it.
 */
function hostLabel(raw: string): string {
  const value = raw.trim() || DEFAULT_CONNECTION.host;
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

export function ConnectModal({ connectionOptions }: { connectionOptions: ConnectionOptions }) {
  useLocale();
  const show = useStore((s) => s.showConnect);
  const dismissible = useStore((s) => Boolean(s.client));
  const status = useStore((s) => s.connectionStatus);
  const connectionError = useStore((s) => s.connectionError);
  const connected = status === "ok";
  const existing = useStore((s) => s.connection);
  const connect = useStore((s) => s.connect);
  const setUI = useStore((s) => s.setUI);

  const [draft, setDraft] = useState(() => createConnectionDraft(existing, connectionOptions));
  const host = connectionDraftHost(draft, connectionOptions);
  const token = draft.tokens[draft.source];
  const [maxRetries, setMaxRetries] = useState(existing?.maxRetries ?? DEFAULT_CONNECTION.maxRetries);
  const [baseDelay, setBaseDelay] = useState(existing?.baseDelay ?? DEFAULT_CONNECTION.baseDelay);
  const [advanced, setAdvanced] = useState(false);
  const [edited, setEdited] = useState(false);
  const verifying = status === "verifying";
  const error = edited ? null : connectionError;
  const rejected = !!error && status === "invalid";

  /**
   * Re-seed the form every time the dialog opens.
   *
   * This component is mounted for the life of the app (Studio renders it unconditionally and Modal
   * handles visibility), so the useState initialisers above run exactly once — during the first
   * render, while `init()` has not yet restored the saved connection and `existing` is still null.
   * They captured an empty token and the default host and never re-ran, so a returning user opened
   * a blank form and reasonably concluded their key had been lost. It never was: it was in
   * localStorage and on the live client the whole time.
   *
   * Derived during render rather than in an effect, matching useDelayedUnmount — an effect would
   * paint one frame of stale fields before correcting them.
   */
  const [prevShow, setPrevShow] = useState(show);
  if (show !== prevShow) {
    setPrevShow(show);
    if (show) {
      const restored = createConnectionDraft(existing, connectionOptions);
      setDraft(restored);
      setMaxRetries(existing?.maxRetries ?? DEFAULT_CONNECTION.maxRetries);
      setBaseDelay(existing?.baseDelay ?? DEFAULT_CONNECTION.baseDelay);
      setEdited(false);
      setAdvanced(restored.source === "custom");
    }
  }

  // Direct-to-NovelAI vs. a proxied host changes both the copy and where credentials travel.
  const isDirect = draft.source === "official";
  const sakuraUnavailable = draft.source === "sakura" && !connectionOptions.sakuraUrl;

  const submit = async () => {
    if (verifying || sakuraUnavailable) return;
    if (!token.trim()) {
      toast.error(isDirect ? translateUI("Please enter your NovelAI API token") : draft.source === "sakura" ? translateUI("Please enter your Sakura key") : translateUI("Please enter your access key"));
      return;
    }
    setEdited(false);
    const ok = await connect(connectionFromDraft(draft, connectionOptions, { maxRetries, baseDelay }));
    if (!ok) return;
    toast.success(isDirect ? translateUI("Connected to NovelAI") : translateUI("Connected"));
  };

  return (
    <Modal
      open={show}
      dismissible={dismissible}
      onClose={() => setUI({ showConnect: false })}
      ariaLabel={translateUI("Welcome to Sakura NAI — connect to start generating")}
      className="max-w-md"
    >
      <div className="mb-3 flex justify-end"><LanguageSwitch /></div>
      <div className="mb-5 flex flex-col items-center text-center">
        <BrandLogo variant="mark" className="mb-3 size-14" />
        <h2 className="font-[family-name:var(--font-display)] text-[21px] font-bold tracking-[-0.02em] text-fg">
          {existing ? translateUI("Connection settings") : translateUI("Welcome to Sakura NAI")}
        </h2>
        {/* The destination is user-configurable, so the privacy claim has to follow it. Saying
            "straight to NovelAI" while Host URL points at a proxy would be a false statement about
            where the key and every prompt actually go.

            Returning users get different copy entirely: telling someone who is already connected to
            "paste your token to start" implies the saved one is gone and invites them to hunt down
            a credential they don't need. */}
        <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted">
          {existing ? (
            <>
              {translateUI("Review the host and access key below, then connect to verify them.")}</>
          ) : isDirect ? (
            <>
              {translateUI(" Paste your NovelAI token to start. It's stored only in this browser and sent straight to NovelAI — never to us. ")}</>
          ) : draft.source === "sakura" ? (
            <>{translateUI("Paste your Sakura key to start. It's stored only in this browser and sent, along with your prompts, to the Sakura relay below.")}</>
          ) : (
            <>
              {translateUI(" Paste your access key to start. It's stored only in this browser and sent, along with your prompts, to the host you've configured below. ")}</>
          )}
        </p>

        {connected && !edited && (
          <span className="mt-3 flex max-w-full items-center gap-2 rounded-[var(--radius-pill)] border border-border-soft bg-surface-2 px-2.5 py-1 text-[11.5px] text-fg-2">
            <span className="size-2 shrink-0 rounded-full bg-ok" style={{ boxShadow: "0 0 8px var(--ok)" }} />
            <span className="truncate font-[family-name:var(--font-mono)]">
              {isDirect ? "NovelAI" : hostLabel(host)}
            </span>
          </span>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="nai-key-type">{translateUI("Key type")}</Label>
          <Select id="nai-key-type" value={draft.source} disabled={verifying} onChange={(e) => {
            const source = e.target.value as ConnectionSource;
            setDraft((previous) => ({ ...previous, source }));
            setEdited(true);
            if (source === "custom") setAdvanced(true);
          }}>
            <option value="sakura" disabled={!connectionOptions.sakuraUrl}>{translateUI("Sakura key")}</option>
            <option value="official">{translateUI("NovelAI official key")}</option>
            <option value="custom">{translateUI("Custom connection")}</option>
          </Select>
          <p className="mt-1.5 break-all font-[family-name:var(--font-mono)] text-[11px] text-muted">{host}</p>
          {!connectionOptions.sakuraUrl && <p className="mt-1 text-[12px] text-warn">{translateUI("Sakura connection is unavailable. Please contact the site owner.")}</p>}
        </div>
        <div>
          <Label htmlFor="nai-token">{isDirect ? translateUI("NovelAI API token") : draft.source === "sakura" ? translateUI("Sakura key") : translateUI("Access key")}</Label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              id="nai-token"
              type="password"
              autoComplete="off"
              placeholder={isDirect ? "pst-..." : translateUI("your access key")}
              className="pl-9 font-[family-name:var(--font-mono)] text-[13px]"
              value={token}
              disabled={verifying}
              aria-invalid={rejected || undefined}
              aria-describedby={error ? "nai-token-error" : undefined}
              onChange={(e) => {
                const value = e.target.value;
                setDraft((previous) => ({ ...previous, tokens: { ...previous.tokens, [previous.source]: value } }));
                setEdited(true);
              }}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          </div>
          {error && (
            <p id="nai-token-error" role="alert" className={`mt-1.5 text-[12.5px] ${rejected ? "text-danger" : "text-warn"}`}>
              {translateUI(error)}
            </p>
          )}
        </div>

        {/* The modal used to demand a token without ever saying where one comes from — a dead end
            for anyone who hadn't already found it. */}
        {isDirect && !rejected && (
          <p className="-mt-1 text-[12px] leading-relaxed text-muted">
            {translateUI(" Find yours in NovelAI under")}{" "}
            <span className="text-fg-2">{translateUI("Account → Get Persistent API Token")}</span>.
          </p>
        )}

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="self-start text-[12.5px] font-semibold text-muted transition-colors hover:text-fg-2"
        >
          {advanced ? translateUI("− Hide") : translateUI("+ Advanced")} {translateUI(" connection settings ")}</button>

        {advanced && (
          <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border-soft bg-surface-2 p-4">
            <div>
              <Label htmlFor="nai-host">{translateUI("Host URL")}</Label>
              <Input id="nai-host" value={host} disabled={verifying} readOnly={draft.source !== "custom"} onChange={(e) => {
                const customHost = e.target.value;
                setDraft((previous) => ({ ...previous, customHost }));
                setEdited(true);
              }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="nai-retries">{translateUI("Max retries")}</Label>
                <NumberInput
                  id="nai-retries"
                  min={0}
                  max={10}
                  value={maxRetries}
                  disabled={verifying}
                  onChange={(e) => setMaxRetries(Number(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="nai-delay">{translateUI("Base delay (ms)")}</Label>
                <NumberInput
                  id="nai-delay"
                  min={500}
                  step={500}
                  value={baseDelay}
                  disabled={verifying}
                  onChange={(e) => setBaseDelay(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        )}

        <Button onClick={() => void submit()} disabled={verifying || sakuraUnavailable} aria-busy={verifying} className="mt-1 w-full">
          {verifying ? (
            <>
              <span
                className="motion-keep size-4 rounded-full border-2 border-current/30 border-t-current"
                style={{ animation: "spin 0.7s linear infinite" }}
                aria-hidden
              />
              {translateUI(" Checking key… ")}</>
          ) : connected ? (
            translateUI("Update connection")
          ) : (
            translateUI("Connect")
          )}
        </Button>
      </div>
    </Modal>
  );
}
