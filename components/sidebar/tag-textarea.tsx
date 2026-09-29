"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TagSuggestion } from "@/lib/nai/protocol";
import { useStore } from "@/lib/store";
import { Textarea } from "@/components/ui/textarea";
import { ClearPromptButton } from "@/components/ui/clear-prompt-button";
import { translateUI } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** The comma/newline-delimited token immediately before the cursor. */
function currentToken(value: string, cursor: number) {
  const before = value.slice(0, cursor);
  const start = Math.max(before.lastIndexOf(","), before.lastIndexOf("\n")) + 1;
  return { token: before.slice(start).trim(), start };
}

type Props = {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
};

/** Textarea with inline NovelAI tag autocomplete (suggestTags). */
export function TagTextarea({ id, value, onChange, placeholder, className, "aria-label": ariaLabel }: Props) {
  const client = useStore((s) => s.client);
  const listId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  // -1 means "nothing chosen yet". This used to initialise to 0, so the top suggestion was
  // pre-selected the instant the popover opened — and Enter, the newline key in a multi-line
  // prompt, silently replaced the token you were typing with a tag you never picked. Enter and Tab
  // now pass through to native behaviour until you explicitly arrow into the list.
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const tokenStart = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  const close = () => {
    requestId.current++;
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  // A body portal escapes character cards and the scrolling sidebar. Keep it anchored to the
  // visible part of the input, including when a modal or sidebar scrolls independently.
  const positionList = useCallback(() => {
    const input = ref.current, list = listRef.current;
    if (!input || !list) return;
    const rect = input.getBoundingClientRect();
    let top = Math.max(8, rect.top), bottom = Math.min(window.innerHeight - 8, rect.bottom);
    for (let parent = input.parentElement; parent; parent = parent.parentElement) {
      if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue;
      const bounds = parent.getBoundingClientRect();
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
    const below = window.innerHeight - bottom - 12, above = top - 12;
    const upwards = below < Math.min(240, list.scrollHeight) && above > below;
    const width = Math.min(rect.width, document.documentElement.clientWidth - 16);
    Object.assign(list.style, {
      visibility: bottom > top ? "visible" : "hidden",
      left: `${Math.max(8, Math.min(rect.left, document.documentElement.clientWidth - width - 8))}px`,
      top: `${upwards ? top - 4 : bottom + 4}px`,
      width: `${width}px`,
      maxHeight: `${Math.max(0, Math.min(240, upwards ? above : below))}px`,
      transform: upwards ? "translateY(-100%)" : "none",
    });
  }, []);

  useLayoutEffect(() => {
    if (open) positionList();
  }, [open, suggestions, value, positionList]);

  useEffect(() => {
    if (!open) return;
    const observer = new ResizeObserver(positionList);
    if (ref.current) observer.observe(ref.current);
    const onScroll = (event: Event) => {
      if (event.target !== listRef.current) positionList();
    };
    window.addEventListener("resize", positionList);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", positionList);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, positionList]);

  useEffect(() => {
    if (open && active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  /**
   * Grow with wrapped content, then hand scrolling back to the textarea at its CSS max-height.
   * Measuring from `auto` is what lets the field shrink again after reset/delete, while the small
   * border correction keeps a border-box textarea from gaining a permanent 2px scrollbar.
   */
  const resizeToContent = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + borders}px`;
    el.style.overflowY = el.scrollHeight > el.clientHeight ? "auto" : "hidden";
  }, []);

  // Layout effect avoids a one-frame flash at the old height when settings are restored, reset, or
  // replaced from the gallery. Normal input and paste flow through the same value update.
  useLayoutEffect(() => {
    resizeToContent();
  }, [value, resizeToContent]);

  // Wrapped line count changes with the drawer/viewport width even when the value does not.
  useEffect(() => {
    window.addEventListener("resize", resizeToContent);
    return () => window.removeEventListener("resize", resizeToContent);
  }, [resizeToContent]);

  const query = (val: string, cursor: number) => {
    close();
    if (!client) return;
    const { token, start } = currentToken(val, cursor);
    tokenStart.current = start;
    if (token.length < 2) return;
    const id = requestId.current;
    timer.current = setTimeout(async () => {
      try {
        const res = await client.suggestTags(token, useStore.getState().settings.model);
        if (id !== requestId.current || document.activeElement !== ref.current) return;
        setSuggestions(res.slice(0, 8));
        setActive(-1);
        setOpen(res.length > 0);
      } catch {
        if (id === requestId.current) setOpen(false);
      }
    }, 250);
  };

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const accept = (s: TagSuggestion) => {
    const el = ref.current;
    if (!el) return;
    const cursor = el.selectionStart ?? value.length;
    const display = s.tag.replace(/_/g, " ");
    const left = value.slice(0, tokenStart.current).replace(/\s*$/, "");
    const right = value.slice(cursor).replace(/^\s*,?\s*/, "");
    const sep = left === "" ? "" : " ";
    const inserted = `${left}${sep}${display}, `;
    const next = inserted + right;
    onChange(next);
    close();
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inserted.length, inserted.length);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      if (open) e.stopPropagation();
      close();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // From -1 this lands on 0 rather than wrapping to the end.
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? suggestions.length : a) - 1);
    } else if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
      // Nothing is selected until the user arrows into the list, so Enter still inserts a newline
      // and Tab still moves focus — the popover no longer traps either.
      // Cmd/Ctrl+Enter belongs to the global Generate accelerator.
      if (active < 0) return;
      const chosen = suggestions[active];
      // `suggestions` can be replaced by an in-flight query between the keystroke and this handler.
      if (!chosen) return;
      e.preventDefault();
      accept(chosen);
    }
  };

  return (
    <div className="relative">
      <Textarea
        id={id}
        ref={ref}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        placeholder={placeholder}
        className={cn(
          "max-h-[min(45dvh,28rem)] resize-none overflow-y-hidden",
          "[scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]",
          className,
          "pr-10",
        )}
        onChange={(e) => {
          onChange(e.target.value);
          query(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => query(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={close}
      />
      <ClearPromptButton label={ariaLabel ?? translateUI("Prompt")} value={value} onClear={() => {
        close();
        setSuggestions([]);
        setActive(-1);
        onChange("");
        ref.current?.focus();
      }} />
      {open && createPortal(
        // tabIndex={-1} is load-bearing: `overflow-y-auto` makes this a scrollable container, and
        // Chrome puts those in the tab order. Tab from the prompt landed here instead of the next
        // field, then the popover closed underneath it and dropped focus to <body>. Selection is
        // driven by aria-activedescendant, so the list must never be a tab stop.
        <ul ref={listRef} id={listId} role="listbox" tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-[80] max-h-60 overflow-y-auto overscroll-contain rounded-[var(--radius-input)] border border-border bg-surface-3 py-1 shadow-xl">
          {suggestions.map((s, i) => (
            <li
              key={s.tag}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onClick={() => accept(s)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px]",
                i === active ? "bg-accent/15 text-fg" : "text-fg-2 hover:bg-surface-2",
              )}
            >
              <span className="truncate">{s.tag.replace(/_/g, " ")}</span>
              {typeof s.count === "number" && (
                <span className="shrink-0 font-[family-name:var(--font-mono)] text-[11px] text-muted">
                  {s.count.toLocaleString()}
                </span>
              )}
            </li>
          ))}
        </ul>, document.body,
      )}
    </div>
  );
}
