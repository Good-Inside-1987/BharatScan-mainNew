import { useState, useEffect } from "react";

export type ThemeMode = "dark" | "light" | "system";
export type AccentColor = "sky" | "violet" | "emerald" | "orange";

const THEME_KEY = "bharatscan-theme";
const COMPACT_KEY = "bharatscan-compact";
const ACCENT_KEY = "bharatscan-accent";

const ACCENT_OVERRIDES: Record<AccentColor, Record<string, string> | null> = {
  sky: null,
  violet: {
    "--primary": "262 70% 60%",
    "--primary-foreground": "0 0% 100%",
    "--primary-glow": "262 70% 72%",
    "--ring": "262 70% 60%",
    "--sidebar-primary": "262 70% 60%",
    "--sidebar-primary-foreground": "0 0% 100%",
    "--sidebar-ring": "262 70% 60%",
  },
  emerald: {
    "--primary": "160 65% 42%",
    "--primary-foreground": "0 0% 100%",
    "--primary-glow": "160 65% 55%",
    "--ring": "160 65% 42%",
    "--sidebar-primary": "160 65% 42%",
    "--sidebar-primary-foreground": "0 0% 100%",
    "--sidebar-ring": "160 65% 42%",
  },
  orange: {
    "--primary": "24 90% 48%",
    "--primary-foreground": "0 0% 100%",
    "--primary-glow": "24 90% 60%",
    "--ring": "24 90% 48%",
    "--sidebar-primary": "24 90% 48%",
    "--sidebar-primary-foreground": "0 0% 100%",
    "--sidebar-ring": "24 90% 48%",
  },
};

const ALL_ACCENT_PROPS = [
  "--primary", "--primary-foreground", "--primary-glow", "--ring",
  "--sidebar-primary", "--sidebar-primary-foreground", "--sidebar-ring",
];

function getSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemeMode(mode: ThemeMode) {
  const resolved = mode === "system" ? getSystemTheme() : mode;
  if (resolved === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

function applyCompact(compact: boolean) {
  if (compact) {
    document.documentElement.classList.add("compact");
  } else {
    document.documentElement.classList.remove("compact");
  }
}

function applyAccent(accent: AccentColor) {
  const root = document.documentElement;
  const overrides = ACCENT_OVERRIDES[accent];
  ALL_ACCENT_PROPS.forEach((p) => root.style.removeProperty(p));
  if (overrides) {
    Object.entries(overrides).forEach(([k, v]) => root.style.setProperty(k, v));
  }
}

export function useTheme() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const s = localStorage.getItem(THEME_KEY);
      if (s === "light" || s === "dark" || s === "system") return s;
    } catch {}
    return "dark";
  });

  const [compactMode, setCompactModeState] = useState<boolean>(() => {
    try { return localStorage.getItem(COMPACT_KEY) === "true"; } catch { return false; }
  });

  const [accentColor, setAccentColorState] = useState<AccentColor>(() => {
    try {
      const s = localStorage.getItem(ACCENT_KEY);
      if (s === "sky" || s === "violet" || s === "emerald" || s === "orange") return s as AccentColor;
    } catch {}
    return "sky";
  });

  useEffect(() => {
    applyThemeMode(themeMode);
    try { localStorage.setItem(THEME_KEY, themeMode); } catch {}

    if (themeMode === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyThemeMode("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [themeMode]);

  useEffect(() => {
    applyCompact(compactMode);
    try { localStorage.setItem(COMPACT_KEY, String(compactMode)); } catch {}
  }, [compactMode]);

  useEffect(() => {
    applyAccent(accentColor);
    try { localStorage.setItem(ACCENT_KEY, accentColor); } catch {}
  }, [accentColor]);

  const resolvedTheme: "dark" | "light" =
    themeMode === "system" ? getSystemTheme() : themeMode;

  const toggleTheme = () =>
    setThemeMode((t) => {
      const cur = t === "system" ? getSystemTheme() : t;
      return cur === "dark" ? "light" : "dark";
    });

  return {
    theme: resolvedTheme,
    themeMode,
    setTheme: setThemeMode,
    toggleTheme,
    compactMode,
    setCompactMode: setCompactModeState,
    accentColor,
    setAccentColor: setAccentColorState,
  };
}
