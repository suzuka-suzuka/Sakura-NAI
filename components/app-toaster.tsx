"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

type Theme = "dark" | "light";

/** Keeps toast chrome in step with the app's attribute-driven theme. */
export function AppToaster() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const sync = () => setTheme(document.documentElement.getAttribute("data-mode") === "light" ? "light" : "dark");
    sync();
    window.addEventListener("nya-theme-change", sync);
    return () => window.removeEventListener("nya-theme-change", sync);
  }, []);

  // The history footer reports its height so notifications sit just above its divider.
  return <Toaster className="nai-toaster" position="bottom-right" theme={theme} richColors
    offset={{ bottom: "calc(var(--nai-toast-bottom, 56px) + env(safe-area-inset-bottom, 0px))" }}
    mobileOffset={{ bottom: "calc(var(--nai-toast-bottom, 56px) + env(safe-area-inset-bottom, 0px))" }} />;
}
