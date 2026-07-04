import type { Condition, Expr, LeafIndicator, Operator, CandleKind, SrcExpr } from "@/lib/screener";
import { newLeafExpr } from "@/lib/screener";
import { TIMEFRAMES, TF_UNIT, isIntradayTf, parseIntradayTf, intradayTfLabel, type Timeframe } from "@/lib/timeframe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { X, Sigma, Copy, CopyPlus, Power, GripVertical } from "lucide-react";
import { useState, useEffect, useRef, Fragment, createContext, useContext } from "react";
import { cn } from "@/lib/utils";

export const NameModeContext = createContext<"full" | "short">("full");

function getTfShort(tf: string): string {
  const p = parseIntradayTf(tf);
  if (p) return p.type === "hr" ? `${p.n}H` : `${p.n} min`;
  const m: Partial<Record<string, string>> = {
    daily: "D", weekly: "W", monthly: "M", quarterly: "Q", yearly: "Y",
  };
  return m[tf] ?? tf;
}

function getTfColor(tf: string): string {
  const p = parseIntradayTf(tf);
  if (p) return p.type === "hr" ? "text-yellow-400" : "text-cyan-400";
  const m: Partial<Record<string, string>> = {
    daily: "text-green-500",
    weekly: "text-indigo-400",
    monthly: "text-sky-400",
    quarterly: "text-purple-400",
    yearly: "text-orange-500",
  };
  return m[tf] ?? "text-foreground";
}

function getTfAccentColor(tf: string): string {
  const m: Partial<Record<string, string>> = {
    daily: "#22c55e",
    weekly: "#818cf8",
    monthly: "#38bdf8",
    quarterly: "#c084fc",
    yearly: "#f97316",
  };
  return m[tf] ?? "rgba(255,255,255,0.3)";
}

const INTRADAY_FIXED_MINS = [5, 10, 15, 30] as const;
const INTRADAY_FIXED_HRS = [1, 2, 3] as const;
const PRIOR_DAY_FIXED = [1, 2, 3] as const;

// Prior-day-from-end encoding: -(PRIOR_DAY_BASE + n)
// e.g. n=1 → last candle of prev day, n=2 → 2nd-last, etc.
const PRIOR_DAY_BASE = 1000;
const isPriorDayOffset = (offset: number) => offset <= -(PRIOR_DAY_BASE + 1);
const parsePriorDayN = (offset: number) => -(offset + PRIOR_DAY_BASE);

/** Short display names for indicators that differ in short mode. */
const KINDS_SHORT: Partial<Record<string, string>> = {
  number: "Num",
  bracket: "Bkt",
  volume: "Vol",
  hamming: "Ham MA",
  psar: "P. SAR",
  bbands: "Bollinger B",
  keltner: "Keltner Ch",
  camarilla: "Camarilla P",
  trad_pivot: "Traditional P",
  fib_pivot: "Fibonacci P",
  woodie_pivot: "Woodie P",
  classic_pivot: "Classic P",
  williams_r: "Will %R",
};

function NumberInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  // Local string state so the user can type freely (including "-", ".", or
  // empty). We only commit a numeric change to the parent when the typed
  // text parses cleanly. This avoids the value snapping back to "0" mid-edit
  // and keeps the field a plain typing area — no spinners, no presets.
  const [text, setText] = useState<string>(String(value));

  // Sync from parent when the value changes externally (e.g. when the
  // condition is reset or duplicated) AND it does not match the user's
  // current text — preserves in-progress typing.
  useEffect(() => {
    if (parseFloat(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      placeholder="0"
      draggable={false}
      className="h-6 bg-input text-xs px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      style={{ width: `calc(${Math.max(2, text.length)}ch + 0.75rem)` }}
      value={text}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        // Commit only valid numeric strings; allow intermediate states like
        // "", "-", "1.", "-." without firing onChange so the parent stays
        // stable until the user types something parseable.
        const parsed = parseFloat(v);
        if (!isNaN(parsed) && /^-?\d*\.?\d+$/.test(v.trim())) {
          onChange(parsed);
        }
      }}
      onBlur={() => {
        // On blur, snap back to the last committed value so the field never
        // displays an un-parseable string.
        if (isNaN(parseFloat(text))) setText(String(value));
      }}
    />
  );
}

/**
 * ParamInput — a robust numeric field for indicator parameters (period, mult,
 * offset, sigma, etc.). Uses local text state so the user can fully clear the
 * field, retype freely, and isn't fighting a synchronous `parseInt() || N`
 * fallback that hijacks each keystroke. Width grows with the typed text so
 * values like 100 or 0.85 are never visually truncated.
 *
 *  - `mode="int"` → only commits whole-number text; uses inputMode="numeric".
 *  - `mode="float"` → commits decimals; uses inputMode="decimal".
 *  - `min` is enforced only on commit (typing "1" while heading toward "10"
 *    is fine even when min=5).
 *  - On blur, snaps to the last valid value (or `fallback` if the field is
 *    empty / unparseable / below min).
 */
function ParamInput({
  value,
  onChange,
  mode = "int",
  step,
  min,
  max,
  fallback,
  title,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  mode?: "int" | "float";
  step?: string | number;
  min?: number;
  max?: number;
  fallback?: number;
  title?: string;
  label?: string;
}) {
  const [text, setText] = useState<string>(String(value));

  useEffect(() => {
    const parsed = mode === "int" ? parseInt(text) : parseFloat(text);
    if (parsed !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const re = mode === "int" ? /^-?\d+$/ : /^-?\d*\.?\d+$/;
  const charLen = Math.max(2, text.length);

  const input = (
    <Input
      type="text"
      inputMode={mode === "int" ? "numeric" : "decimal"}
      title={title}
      step={step}
      className="h-6 bg-input text-xs px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      style={{ width: `calc(${charLen}ch + 0.75rem)` }}
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (!re.test(v.trim())) return;
        const parsed = mode === "int" ? parseInt(v) : parseFloat(v);
        if (isNaN(parsed)) return;
        if (min !== undefined && parsed < min) return;
        if (max !== undefined && parsed > max) return;
        onChange(parsed);
      }}
      onBlur={() => {
        const parsed = mode === "int" ? parseInt(text) : parseFloat(text);
        const invalid =
          isNaN(parsed) ||
          !re.test(text.trim()) ||
          (min !== undefined && parsed < min) ||
          (max !== undefined && parsed > max);
        if (invalid) {
          const f = fallback ?? value;
          setText(String(f));
          onChange(f);
        } else {
          // Normalize trailing-dot / leading-zero text to the parsed form.
          setText(String(parsed));
        }
      }}
    />
  );
  if (!label) return input;
  return (
    <span className="inline-flex items-center gap-0.5">
      {input}
      <span className="text-[10px] text-muted-foreground/40 leading-none">({label})</span>
    </span>
  );
}

function tfLabel(tf: string): string {
  if (isIntradayTf(tf)) return intradayTfLabel(tf);
  return TIMEFRAMES.find((t) => t.value === tf)?.label ?? tf;
}

function agoLabel(tf: string, n: number, short = false): string {
  if (isIntradayTf(tf)) {
    return `[-${n}] ${short ? getTfShort(tf) : intradayTfLabel(tf)}`;
  }
  if (short) return `${n} ${getTfShort(tf)} ago`;
  const unit = (TF_UNIT[tf as Timeframe] ?? tf).toLowerCase();
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

function TimeframePicker({
  tf,
  daysAgo,
  onChange,
}: {
  tf: string;
  daysAgo: number;
  onChange: (tf: string, daysAgo: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Pending candle offset for intraday (chosen in the offset panel before picking an interval)
  const [pendingOffset, setPendingOffset] = useState(0);
  const [editingPendingOffset, setEditingPendingOffset] = useState(false);
  const [pendingOffsetText, setPendingOffsetText] = useState("");
  const pendingOffsetRef = useRef<HTMLInputElement | null>(null);
  // Days-nth candle custom edit
  const [editingDaysNth, setEditingDaysNth] = useState(false);
  const [daysNthText, setDaysNthText] = useState("");
  const daysNthRef = useRef<HTMLInputElement | null>(null);
  // EOD n-ago custom edit
  const [editingTf, setEditingTf] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>("");
  const editInputRef = useRef<HTMLInputElement | null>(null);
  // Custom intraday interval inputs
  const [customMinInput, setCustomMinInput] = useState(false);
  const [customMinText, setCustomMinText] = useState("");
  const [customHrInput, setCustomHrInput] = useState(false);
  const [customHrText, setCustomHrText] = useState("");
  const customMinRef = useRef<HTMLInputElement | null>(null);
  const customHrRef = useRef<HTMLInputElement | null>(null);
  // Prior days candle custom edit
  const [editingPriorDay, setEditingPriorDay] = useState(false);
  const [priorDayText, setPriorDayText] = useState("");
  const priorDayRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setPendingOffset(isIntradayTf(tf) ? daysAgo : 0);
      setSearchQuery("");
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setEditingTf(null);
      setEditText("");
      setEditingPendingOffset(false);
      setPendingOffsetText("");
      setEditingDaysNth(false);
      setDaysNthText("");
      setCustomMinInput(false);
      setCustomMinText("");
      setCustomHrInput(false);
      setCustomHrText("");
      setEditingPriorDay(false);
      setPriorDayText("");
      setSearchQuery("");
    }
  }, [open]);

  useEffect(() => {
    if (editingTf !== null) requestAnimationFrame(() => editInputRef.current?.focus());
  }, [editingTf]);

  useEffect(() => {
    if (editingPendingOffset) requestAnimationFrame(() => pendingOffsetRef.current?.focus());
  }, [editingPendingOffset]);

  useEffect(() => {
    if (editingDaysNth) requestAnimationFrame(() => daysNthRef.current?.focus());
  }, [editingDaysNth]);

  useEffect(() => {
    if (customMinInput) requestAnimationFrame(() => customMinRef.current?.focus());
  }, [customMinInput]);

  useEffect(() => {
    if (customHrInput) requestAnimationFrame(() => customHrRef.current?.focus());
  }, [customHrInput]);

  useEffect(() => {
    if (editingPriorDay) requestAnimationFrame(() => priorDayRef.current?.focus());
  }, [editingPriorDay]);

  const nameMode = useContext(NameModeContext);
  const isShort = nameMode === "short";

  const currentIntraday = parseIntradayTf(tf);
  const isCurrentIntraday = currentIntraday !== null;

  // Prior-day derived state
  const isPriorDayPending = isPriorDayOffset(pendingOffset);
  const pendingPriorDayN = isPriorDayPending ? parsePriorDayN(pendingOffset) : 1;
  const pendingPriorDayIsCustom = isPriorDayPending && pendingPriorDayN > 5;

  const triggerLabel = isCurrentIntraday
    ? `${
        isPriorDayOffset(daysAgo)
          ? `[=-${parsePriorDayN(daysAgo)}]`
          : daysAgo < 0 ? `[=${-daysAgo}]` : `[${daysAgo === 0 ? 0 : -daysAgo}]`
      } ${isShort ? getTfShort(tf) : intradayTfLabel(tf)}`
    : daysAgo === 0
    ? tfLabel(tf)
    : agoLabel(tf, daysAgo, isShort);

  // Pick an intraday interval — combines with the selected pendingOffset
  const pickIntraday = (interval: string) => {
    onChange(interval, pendingOffset);
    setOpen(false);
  };

  // EOD preset pick
  const pickPreset = (newTf: string, n: number) => {
    onChange(newTf, n);
    setOpen(false);
  };

  const startCustomEdit = (newTf: string) => {
    setEditingTf(newTf);
    setEditText(newTf === tf && daysAgo > 2 ? String(daysAgo) : "");
  };

  const commitCustomEdit = (newTf: string) => {
    const n = parseInt(editText);
    if (!isNaN(n) && n > 0) {
      onChange(newTf, n);
      setOpen(false);
    }
    setEditingTf(null);
    setEditText("");
  };

  // pendingOffset >= 0 → candles-ago offset; pendingOffset < 0 → nth candle of day (encoded as -n)
  // Prior-day candles use -(PRIOR_DAY_BASE + n) range, so exclude them from daysNthIsCustom
  const pendingOffsetIsCustom = pendingOffset > 2;
  const pendingDaysNthIsCustom = pendingOffset < -3 && !isPriorDayOffset(pendingOffset);

  const isCurrentCustomMin =
    isCurrentIntraday && currentIntraday!.type === "min" &&
    !(INTRADAY_FIXED_MINS as readonly number[]).includes(currentIntraday!.n);
  const isCurrentCustomHr =
    isCurrentIntraday && currentIntraday!.type === "hr" &&
    !(INTRADAY_FIXED_HRS as readonly number[]).includes(currentIntraday!.n);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-6 px-2 rounded-md bg-input text-xs inline-flex items-center border border-input hover:bg-input/80 whitespace-nowrap w-auto"
        >
          <span className={getTfColor(tf)}>{triggerLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0 flex flex-col" align="start" avoidCollisions={true} collisionPadding={8} style={{ maxHeight: "min(400px, calc(100vh - 80px))" }}>
        {/* ── Search bar (sticky, never scrolls away) ── */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border shrink-0">
          <svg className="h-3 w-3 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search timeframe…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); if (searchQuery) { setSearchQuery(""); } else { setOpen(false); } } }}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 text-foreground"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} className="text-muted-foreground hover:text-foreground">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>

        {/* ── Filtered search results ── */}
        {searchQuery.trim() !== "" ? (() => {
          const q = searchQuery.trim().toLowerCase();
          type FlatItem = { label: string; colorClass: string; action: () => void; isSelected: boolean; isIntraday?: boolean };
          const items: FlatItem[] = [];
          // Minutes
          INTRADAY_FIXED_MINS.forEach((mins) => {
            const itf = `m${mins}`;
            const lbl = `${mins} minute`;
            if ([lbl, `${mins}m`, `${mins}min`, "minute", "min", "intraday", String(mins)].some((k) => k.includes(q))) {
              items.push({ label: lbl, colorClass: "text-cyan-400", action: () => pickIntraday(itf), isSelected: tf === itf, isIntraday: true });
            }
          });
          // Hours
          INTRADAY_FIXED_HRS.forEach((hrs) => {
            const itf = `h${hrs}`;
            const lbl = hrs === 1 ? "1 hour" : `${hrs} hours`;
            if ([lbl, `${hrs}h`, `${hrs}hr`, "hour", "hours", "intraday", String(hrs)].some((k) => k.includes(q))) {
              items.push({ label: lbl, colorClass: "text-yellow-400", action: () => pickIntraday(itf), isSelected: tf === itf, isIntraday: true });
            }
          });
          // Prior days candles
          PRIOR_DAY_FIXED.forEach((n) => {
            const enc = -(PRIOR_DAY_BASE + n);
            const lbl = n === 1 ? "=-1 (previous day last candle)" : `=-${n} (previous day ${n === 2 ? "2nd" : n === 3 ? "3rd" : n === 4 ? "4th" : "5th"}-last candle)`;
            const keys = [lbl, `=-${n}`, "prior day", "previous day", "prior", "last candle", String(n)];
            if (keys.some((k) => k.toLowerCase().includes(q))) {
              items.push({
                label: lbl,
                colorClass: "text-amber-400",
                action: () => { setPendingOffset(enc); },
                isSelected: isPriorDayOffset(daysAgo) && parsePriorDayN(daysAgo) === n,
              });
            }
          });
          // EOD timeframes
          TIMEFRAMES.forEach((t) => {
            const unit = TF_UNIT[t.value].toLowerCase();
            const color = getTfColor(t.value);
            const accent = getTfAccentColor(t.value);
            // Current: e.g. "Daily"
            if ([t.label.toLowerCase(), t.value, unit, "eod", "candle"].some((k) => k.includes(q))) {
              items.push({ label: t.label, colorClass: color, action: () => pickPreset(t.value, 0), isSelected: tf === t.value && daysAgo === 0 });
            }
            // 1 & 2 ago
            [1, 2].forEach((n) => {
              const lbl = `${n} ${unit}${n === 1 ? "" : "s"} ago`;
              if ([lbl, `${n}${unit[0]}`, unit, "ago", "eod", String(n)].some((k) => k.includes(q))) {
                items.push({ label: lbl, colorClass: color, action: () => pickPreset(t.value, n), isSelected: tf === t.value && daysAgo === n });
              }
            });
          });
          if (items.length === 0) {
            return (
              <div className="overflow-y-auto flex-1">
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">No timeframe found</div>
              </div>
            );
          }
          return (
            <div className="overflow-y-auto flex-1 py-1">
              {items.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={item.action}
                  className={`w-full text-left text-xs px-3 py-1.5 hover:bg-muted hover:text-foreground ${
                    item.isSelected ? "bg-muted text-foreground" : ""
                  }`}
                  style={item.isSelected ? { boxShadow: `inset 2px 0 0 ${(() => { const m: Record<string,string> = { "text-cyan-400": "rgba(103,232,249,0.5)", "text-yellow-400": "rgba(250,204,21,0.5)", "text-green-500": "#22c55e", "text-indigo-400": "#818cf8", "text-sky-400": "#38bdf8", "text-purple-400": "#c084fc", "text-orange-500": "#f97316" }; return m[item.colorClass] ?? "rgba(255,255,255,0.2)"; })()}` } : undefined}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={item.colorClass}>{item.label}</span>
                    {item.isIntraday && (
                      <span className="text-[9px] font-semibold text-orange-400 bg-orange-400/10 border border-orange-400/30 rounded px-1 py-0.5 leading-none">No data</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          );
        })() : (
        <div className="py-1 overflow-y-auto flex-1">

          {/* ── INTRADAY at top ── */}
          <div className="text-[10px] uppercase tracking-wider px-3 pt-2 pb-1 text-foreground font-bold">
            Intraday candles
          </div>

          {/* Candle offset panel */}
          <div className="text-[10px] uppercase tracking-wide px-3 pb-1 text-muted-foreground">
            Latest candles
          </div>
          <div className="flex flex-wrap gap-1 px-3 pb-2">
            <TooltipProvider delayDuration={0}>
            {([0, 1, 2] as const).map((n) => {
              const latestLabels = ["Current Candle", "Previous Candle", "2 Candles Back"];
              return (
              <Tooltip key={n}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setPendingOffset(n)}
                    className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                      pendingOffset === n && pendingOffset >= 0 && !pendingOffsetIsCustom
                        ? "bg-muted text-foreground ring-1 ring-border"
                        : "text-cyan-400 hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    [{-n}]
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px] px-2 py-0.5">{latestLabels[n]}</TooltipContent>
              </Tooltip>
              );
            })}
            </TooltipProvider>
            {editingPendingOffset ? (
              <span className="flex items-center gap-0.5">
                <span className="text-[10px] text-cyan-400">[-</span>
                <Input
                  ref={pendingOffsetRef}
                  type="number"
                  min={1}
                  placeholder="n"
                  className="h-5 w-10 bg-input text-xs px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={pendingOffsetText}
                  onChange={(e) => setPendingOffsetText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const n = parseInt(pendingOffsetText);
                      if (!isNaN(n) && n > 0) setPendingOffset(n);
                      setEditingPendingOffset(false);
                      setPendingOffsetText("");
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingPendingOffset(false);
                      setPendingOffsetText("");
                    }
                  }}
                  onBlur={() => {
                    const n = parseInt(pendingOffsetText);
                    if (!isNaN(n) && n > 0) setPendingOffset(n);
                    setEditingPendingOffset(false);
                    setPendingOffsetText("");
                  }}
                />
                <span className="text-[10px] text-cyan-400">]</span>
              </span>
            ) : (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPendingOffset(true);
                        setPendingOffsetText(pendingOffsetIsCustom ? String(pendingOffset) : "");
                      }}
                      className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                        pendingOffsetIsCustom
                          ? "bg-muted text-foreground ring-1 ring-border"
                          : "text-cyan-400 hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {pendingOffsetIsCustom ? `[-${pendingOffset}]` : "[-n]"}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[10px] px-2 py-0.5">Custom: n Candles Back</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* Days nth candles sub-section */}
          <div className="text-[10px] uppercase tracking-wide px-3 pb-1 text-muted-foreground border-t border-border/40 pt-2">
            Days nth candles
          </div>
          <div className="flex flex-wrap gap-1 px-3 pb-2.5">
            <TooltipProvider delayDuration={0}>
            {([1, 2, 3] as const).map((n) => {
              const ordinals = ["1st", "2nd", "3rd"];
              return (
              <Tooltip key={n}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setPendingOffset(-n)}
                    className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                      pendingOffset === -n
                        ? "bg-muted text-foreground ring-1 ring-border"
                        : "text-purple-400 hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    [={n}]
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px] px-2 py-0.5">{ordinals[n - 1]} Candle of the Day</TooltipContent>
              </Tooltip>
              );
            })}
            </TooltipProvider>
            {editingDaysNth ? (
              <span className="flex items-center gap-0.5">
                <span className="text-[10px] text-purple-400">[=</span>
                <Input
                  ref={daysNthRef}
                  type="number"
                  min={1}
                  placeholder="n"
                  className="h-5 w-10 bg-input text-xs px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={daysNthText}
                  onChange={(e) => setDaysNthText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const n = parseInt(daysNthText);
                      if (!isNaN(n) && n > 0) setPendingOffset(-n);
                      setEditingDaysNth(false);
                      setDaysNthText("");
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingDaysNth(false);
                      setDaysNthText("");
                    }
                  }}
                  onBlur={() => {
                    const n = parseInt(daysNthText);
                    if (!isNaN(n) && n > 0) setPendingOffset(-n);
                    setEditingDaysNth(false);
                    setDaysNthText("");
                  }}
                />
                <span className="text-[10px] text-purple-400">]</span>
              </span>
            ) : (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingDaysNth(true);
                        setDaysNthText(pendingDaysNthIsCustom ? String(-pendingOffset) : "");
                      }}
                      className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                        pendingDaysNthIsCustom
                          ? "bg-muted text-foreground ring-1 ring-border"
                          : "text-purple-400 hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {pendingDaysNthIsCustom ? `[=${-pendingOffset}]` : "[=n]"}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[10px] px-2 py-0.5">Custom: nth Candle of the Day</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* ── Prior days candles ── */}
          <div className="text-[10px] uppercase tracking-wide px-3 pb-0.5 text-muted-foreground border-t border-border/50 pt-2">
            Prior days candles
          </div>
          <div className="flex flex-nowrap items-center gap-1 px-3 pb-2 pt-0.5">
            <TooltipProvider delayDuration={0}>
            {PRIOR_DAY_FIXED.map((n) => {
              const enc = -(PRIOR_DAY_BASE + n);
              const isSelected = pendingOffset === enc;
              const labels = ["Previous day's last candle", "Previous day's 2nd-last candle", "Previous day's 3rd-last candle"];
              return (
                <Tooltip key={n}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingOffset(enc);
                        setEditingPriorDay(false);
                        setPriorDayText("");
                      }}
                      className={`text-xs px-1.5 py-0.5 rounded font-mono whitespace-nowrap ${
                        isSelected
                          ? "bg-muted text-foreground ring-1 ring-amber-400/60"
                          : "text-amber-400 hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      [=-{n}]
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[10px] px-2 py-0.5">{labels[n - 1]}</TooltipContent>
                </Tooltip>
              );
            })}
            </TooltipProvider>
            {editingPriorDay ? (
              <span className="flex items-center gap-0.5">
                <span className="text-xs font-mono text-amber-400">[=-</span>
                <Input
                  ref={priorDayRef}
                  type="number"
                  min={1}
                  placeholder="n"
                  className="h-5 w-10 bg-input text-xs px-1 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={priorDayText}
                  onChange={(e) => setPriorDayText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const n = parseInt(priorDayText);
                      if (!isNaN(n) && n >= 1) setPendingOffset(-(PRIOR_DAY_BASE + n));
                      setEditingPriorDay(false);
                      setPriorDayText("");
                    }
                    if (e.key === "Escape") {
                      setEditingPriorDay(false);
                      setPriorDayText("");
                    }
                  }}
                  onBlur={() => {
                    const n = parseInt(priorDayText);
                    if (!isNaN(n) && n >= 1) setPendingOffset(-(PRIOR_DAY_BASE + n));
                    setEditingPriorDay(false);
                    setPriorDayText("");
                  }}
                />
                <span className="text-xs font-mono text-amber-400">]</span>
              </span>
            ) : (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPriorDay(true);
                        setPriorDayText(pendingPriorDayIsCustom ? String(pendingPriorDayN) : "");
                      }}
                      className={`text-xs px-1.5 py-0.5 rounded font-mono whitespace-nowrap ${
                        pendingPriorDayIsCustom
                          ? "bg-muted text-foreground ring-1 ring-border"
                          : "text-amber-400 hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {pendingPriorDayIsCustom ? `[=-${pendingPriorDayN}]` : "[=-n]"}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[10px] px-2 py-0.5">Custom: nth-last candle of previous day</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* Minutes interval list */}
          <div className="text-[10px] uppercase tracking-wide px-3 pb-0.5 text-muted-foreground border-t border-border/50 pt-2">
            Minutes
          </div>
          {INTRADAY_FIXED_MINS.map((mins) => {
            const itf = `m${mins}`;
            return (
              <button
                key={itf}
                type="button"
                onClick={() => pickIntraday(itf)}
                className={`w-full text-left text-xs px-3 py-1.5 hover:bg-muted hover:text-foreground ${
                  tf === itf ? "bg-muted text-foreground [box-shadow:inset_2px_0_0_rgba(103,232,249,0.5)]" : ""
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-cyan-400">{mins} minute</span>
                  <span className="text-[9px] font-semibold text-orange-400 bg-orange-400/10 border border-orange-400/30 rounded px-1 py-0.5 leading-none">No data</span>
                </span>
              </button>
            );
          })}
          {isCurrentCustomMin && (
            <button
              type="button"
              onClick={() => pickIntraday(tf)}
              className="w-full text-left text-xs px-3 py-1.5 bg-muted text-foreground [box-shadow:inset_2px_0_0_rgba(103,232,249,0.5)]"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-cyan-400">{currentIntraday!.n} minute</span>
                <span className="text-[9px] font-semibold text-orange-400 bg-orange-400/10 border border-orange-400/30 rounded px-1 py-0.5 leading-none">No data</span>
              </span>
            </button>
          )}
          {customMinInput ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60">
              <Input
                ref={customMinRef}
                type="number"
                min={1}
                placeholder="minutes"
                className="h-7 bg-input text-xs px-2 flex-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                value={customMinText}
                onChange={(e) => setCustomMinText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const n = parseInt(customMinText);
                    if (!isNaN(n) && n > 0) { pickIntraday(`m${n}`); }
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setCustomMinInput(false);
                    setCustomMinText("");
                  }
                }}
                onBlur={() => { setCustomMinInput(false); setCustomMinText(""); }}
              />
              <span className="text-[10px] text-cyan-400 whitespace-nowrap">min</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCustomMinInput(true)}
              className="w-full text-left text-xs px-3 py-1.5 hover:bg-muted hover:text-foreground"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-cyan-400">n minute</span>
                <span className="text-[9px] font-semibold text-orange-400 bg-orange-400/10 border border-orange-400/30 rounded px-1 py-0.5 leading-none">No data</span>
              </span>
            </button>
          )}

          {/* Hours interval list */}
          <div className="text-[10px] uppercase tracking-wide px-3 pb-0.5 text-muted-foreground border-t border-border/50 pt-2">
            Hours
          </div>
          {INTRADAY_FIXED_HRS.map((hrs) => {
            const itf = `h${hrs}`;
            return (
              <button
                key={itf}
                type="button"
                onClick={() => pickIntraday(itf)}
                className={`w-full text-left text-xs px-3 py-1.5 hover:bg-muted hover:text-foreground ${
                  tf === itf ? "bg-muted text-foreground [box-shadow:inset_2px_0_0_rgba(250,204,21,0.5)]" : ""
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-yellow-400">{hrs === 1 ? "1 hour" : `${hrs} hours`}</span>
                  <span className="text-[9px] font-semibold text-orange-400 bg-orange-400/10 border border-orange-400/30 rounded px-1 py-0.5 leading-none">No data</span>
                </span>
              </button>
            );
          })}
          {isCurrentCustomHr && (
            <button
              type="button"
              onClick={() => pickIntraday(tf)}
              className="w-full text-left text-xs px-3 py-1.5 bg-muted text-foreground [box-shadow:inset_2px_0_0_rgba(250,204,21,0.5)]"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-yellow-400">{currentIntraday!.n} hours</span>
                <span className="text-[9px] font-semibold text-orange-400 bg-orange-400/10 border border-orange-400/30 rounded px-1 py-0.5 leading-none">No data</span>
              </span>
            </button>
          )}
          {customHrInput ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60">
              <Input
                ref={customHrRef}
                type="number"
                min={1}
                placeholder="hours"
                className="h-7 bg-input text-xs px-2 flex-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                value={customHrText}
                onChange={(e) => setCustomHrText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const n = parseInt(customHrText);
                    if (!isNaN(n) && n > 0) { pickIntraday(`h${n}`); }
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setCustomHrInput(false);
                    setCustomHrText("");
                  }
                }}
                onBlur={() => { setCustomHrInput(false); setCustomHrText(""); }}
              />
              <span className="text-[10px] text-yellow-400 whitespace-nowrap">hr</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCustomHrInput(true)}
              className="w-full text-left text-xs px-3 py-1.5 hover:bg-muted hover:text-foreground"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-yellow-400">n hour</span>
                <span className="text-[9px] font-semibold text-orange-400 bg-orange-400/10 border border-orange-400/30 rounded px-1 py-0.5 leading-none">No data</span>
              </span>
            </button>
          )}

          {/* ── EOD timeframes below ── */}
          <div className="text-[10px] uppercase tracking-wider px-3 pt-3 pb-1 text-foreground font-bold border-t border-border mt-1">
            EOD candles
          </div>
          {TIMEFRAMES.map((t) => {
            const unit = TF_UNIT[t.value].toLowerCase();
            const isActiveCustom = tf === t.value && daysAgo > 2;
            const isEditing = editingTf === t.value;
            return (
              <div key={t.value} className="pb-1" style={{ "--tf-accent": getTfAccentColor(t.value) } as React.CSSProperties}>
                <div className="text-[10px] uppercase tracking-wide px-3 pt-1 pb-1 text-muted-foreground">
                  {t.label} candles
                </div>
                <button
                  type="button"
                  onClick={() => pickPreset(t.value, 0)}
                  className={`w-full text-left text-xs px-3 py-1.5 hover:bg-muted hover:text-foreground ${
                    tf === t.value && daysAgo === 0 ? `bg-muted text-foreground [box-shadow:inset_2px_0_0_var(--tf-accent)]` : ""
                  }`}
                >
                  <span className={getTfColor(t.value)}>{t.label}</span>
                </button>
                {[1, 2].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => pickPreset(t.value, n)}
                    className={`w-full text-left text-xs px-3 py-1.5 hover:bg-muted hover:text-foreground ${
                      tf === t.value && daysAgo === n ? `bg-muted text-foreground [box-shadow:inset_2px_0_0_var(--tf-accent)]` : ""
                    }`}
                  >
                    <span className={getTfColor(t.value)}>
                      {isShort ? `${n} ${getTfShort(t.value)} ago` : `${n} ${unit}${n === 1 ? "" : "s"} ago`}
                    </span>
                  </button>
                ))}
                {isEditing ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60">
                    <Input
                      ref={editInputRef}
                      type="number"
                      min={1}
                      placeholder="n"
                      className="h-7 bg-input text-xs px-2 flex-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitCustomEdit(t.value); }
                        else if (e.key === "Escape") { e.preventDefault(); setEditingTf(null); setEditText(""); }
                      }}
                      onBlur={() => commitCustomEdit(t.value)}
                    />
                    <span className={`text-[10px] whitespace-nowrap ${getTfColor(t.value)}`}>
                      {isShort ? `${getTfShort(t.value)} ago` : `${unit}s ago`}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startCustomEdit(t.value)}
                    className={`w-full text-left text-xs px-3 py-1.5 hover:bg-muted hover:text-foreground ${
                      isActiveCustom ? `bg-muted text-foreground [box-shadow:inset_2px_0_0_var(--tf-accent)]` : ""
                    }`}
                    title="Set a custom number of periods ago"
                  >
                    <span className={getTfColor(t.value)}>
                      {isActiveCustom
                        ? agoLabel(t.value, daysAgo, isShort)
                        : (isShort ? `n ${getTfShort(t.value)} ago` : `n ${unit}s ago`)}
                    </span>
                  </button>
                )}
              </div>
            );
          })}

        </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface Props {
  condition: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  onCopy?: () => void;
  onToggle?: () => void;
  isDragging?: boolean;
  isDragOver?: boolean;
  dragPush?: "up" | "down";
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}

type IndKind = LeafIndicator["kind"];

// Each item has a short name (shown bold) and an optional full name (shown
// smaller in parentheses next to it). The dropdown is organized into
// sections — top-level Numbers/OHLC sit on their own, while Overlay
// Indicators and Oscillators are parent sections containing sub-categories.
type IndItem = { value: IndKind; short: string; full?: string };
type IndCategory = { heading: string; items: IndItem[] };
type IndSection = { section?: string; categories: IndCategory[] };

const IND_SECTIONS: IndSection[] = [
  {
    categories: [
      { heading: "Numbers", items: [
        { value: "number", short: "Number" },
        { value: "bracket", short: "Bracket", full: "Group expression in ( )" },
      ] },
      {
        heading: "OHLC",
        items: [
          { value: "close", short: "Close" },
          { value: "open", short: "Open" },
          { value: "high", short: "High" },
          { value: "low", short: "Low" },
          { value: "volume", short: "Volume" },
          { value: "change_pct", short: "% Change" },
          { value: "hl2",        short: "HL2",      full: "(High + Low) / 2" },
          { value: "hlc3",       short: "HLC3",     full: "(High + Low + Close) / 3" },
          { value: "ohlc4",      short: "OHLC4",    full: "(Open + High + Low + Close) / 4" },
        ],
      },
    ],
  },
  {
    section: "Overlay Indicators",
    categories: [
      {
        heading: "Moving Averages",
        items: [
          { value: "ema", short: "EMA", full: "Exponential Moving Average" },
          { value: "sma", short: "SMA", full: "Simple Moving Average" },
          { value: "wma", short: "WMA", full: "Weighted Moving Average" },
          { value: "vwma", short: "VWMA", full: "Volume-Weighted Moving Average" },
          { value: "alma", short: "ALMA", full: "Arnaud Legoux Moving Average" },
          { value: "hma", short: "HMA", full: "Hull Moving Average" },
          { value: "smma", short: "SMMA", full: "Smoothed Moving Average" },
          { value: "lsma", short: "LSMA", full: "Least Squares Moving Average" },
          { value: "kama", short: "KAMA", full: "Moving Average Adaptive" },
          { value: "hamming", short: "Hamming MA", full: "Moving Average Hamming" },
          { value: "jma", short: "JMA", full: "Jurik Moving Average" },
          { value: "mac", short: "MAC", full: "Moving Average Channel" },
        ],
      },
      {
        heading: "Trend Indicators",
        items: [
          { value: "supertrend", short: "Supertrend" },
          { value: "halftrend", short: "Halftrend" },
          { value: "halftrend_bull", short: "Halftrend Bull" },
          { value: "halftrend_bear", short: "Halftrend Bear" },
          { value: "psar", short: "Parabolic SAR" },
          { value: "ladder_atr", short: "Ladder ATR" },
          { value: "chandelier", short: "Chandelier" },
          { value: "atr_ts", short: "ATR TS", full: "ATR Trailing Stop" },
        ],
      },
      {
        heading: "Price Bands & Channel",
        items: [
          { value: "bbands", short: "Bollinger Bands" },
          { value: "bb_pctb", short: "BB %B", full: "Bollinger Bands %B" },
          { value: "keltner", short: "Keltner Channels" },
          { value: "donchian", short: "DC", full: "Donchian Channels" },
          { value: "vwap", short: "VWAP" },
          { value: "ichimoku", short: "Ichimoku", full: "Ichimoku Cloud" },
        ],
      },
      {
        heading: "Support & Resistance Levels",
        items: [
          { value: "cpr", short: "CPR" },
          { value: "camarilla", short: "Camarilla Pivot" },
          { value: "trad_pivot", short: "Traditional Pivot" },
          { value: "fib_pivot", short: "Fibonacci Pivot" },
          { value: "woodie_pivot", short: "Woodie Pivot" },
          { value: "classic_pivot", short: "Classic Pivot" },
        ],
      },
    ],
  },
  {
    section: "Oscillators & Sub-chart Indicators",
    categories: [
      {
        heading: "Momentum Oscillators",
        items: [
          { value: "rsi", short: "RSI", full: "Relative Strength Index" },
          { value: "cci", short: "CCI", full: "Commodity Channel Index" },
          { value: "williams_r", short: "Williams %R" },
          { value: "stoch", short: "Stoch Osc", full: "Stochastic Oscillator" },
          { value: "macd", short: "MACD", full: "Moving Average Convergence Divergence" },
          { value: "obv", short: "OBV", full: "On-Balance Volume" },
          { value: "mfi", short: "MFI", full: "Money Flow Index" },
          { value: "cmf", short: "CMF", full: "Chaikin Money Flow" },
          { value: "dpo", short: "DPO", full: "Detrended Price Oscillator" },
          { value: "atr", short: "ATR", full: "Average True Range" },
          { value: "adx", short: "ADX", full: "Average Directional Index" },
          { value: "dmi", short: "DMI", full: "Directional Movement Index" },
          { value: "aroon", short: "Aroon" },
          { value: "stoch_rsi", short: "Stoch RSI", full: "Stochastic RSI" },
        ],
      },
    ],
  },
];

// Flat lookup used for the trigger-button label and any internal kind→label
// mapping. Includes legacy kinds (prev_close, high_n, low_n, pattern, price)
// so previously-saved scans still render a friendly label even though those
// kinds are no longer surfaced in the picker.
const KINDS: { value: IndKind; label: string }[] = [
  ...IND_SECTIONS.flatMap((s) => s.categories.flatMap((c) => c.items.map((i) => ({ value: i.value, label: i.short })))),
  { value: "prev_close", label: "Prev Close" },
  { value: "high_n", label: "Highest High" },
  { value: "low_n", label: "Lowest Low" },
  { value: "pattern", label: "Candle Pattern" },
  { value: "price", label: "Price" },
];

// All operators surfaced through the unified `OperatorPicker`. Each item has
// a short symbol (shown in the trigger button) and a long label (shown in the
// dropdown list). Comparison ops connect the left and right sides of a
// condition; arithmetic ops combine two leaves into a binop expression.
const COMPARISON_OPS: { value: Operator; label: string; shortLabel?: string; symbol: string }[] = [
  { value: "crossed_above", label: "cross above", shortLabel: "cross abv", symbol: "↗" },
  { value: "crossed_below", label: "cross below", shortLabel: "cross blw", symbol: "↘" },
  { value: ">", label: "greater than", symbol: ">" },
  { value: ">=", label: "greater than equal", symbol: "≥" },
  { value: "<", label: "less than", symbol: "<" },
  { value: "<=", label: "less than equal", symbol: "≤" },
  { value: "==", label: "equal to", symbol: "=" },
  { value: "!=", label: "not equal to", symbol: "≠" },
];

type ArithOp = "+" | "-" | "*" | "/";
const ARITH_OPS: { value: ArithOp; label: string; symbol: string }[] = [
  { value: "+", label: "plus", symbol: "+" },
  { value: "-", label: "minus", symbol: "−" },
  { value: "*", label: "multiply by", symbol: "×" },
  { value: "/", label: "divided by", symbol: "÷" },
];

/**
 * Unified "Comparative Operator" picker — one widget used for the comparison
 * op (>, <, ==, …), the inner arithmetic op of a wrapped expression
 * (+, −, ×, ÷), and the Σ "wrap into expression" trigger. All three look
 * identical: same dropdown style, same "Comparative Operator" header. When
 * the value is empty / — none —, the trigger shows a Σ (Sigma) icon so the
 * field is never visually blank.
 *
 * `groups` controls which operator sections are shown; `allowNone` adds a
 * "— none —" item that emits `""` (used by the inner binop op to unwrap the
 * expression).
 */
function OperatorPicker({
  value,
  onChange,
  actionable,
  allowNone = false,
  triggerStyle = "label",
  triggerClassName,
  title,
}: {
  value: string;
  onChange: (op: string) => void;
  /**
   * Which groups can actually be picked at this call-site. The dropdown
   * ALWAYS shows both Compare and Arithmetic sections (so every trigger
   * surfaces the same unified panel) — items outside `actionable` are still
   * listed but rendered disabled / muted.
   */
  actionable: ("comparison" | "arithmetic")[];
  allowNone?: boolean;
  triggerStyle?: "label" | "symbol" | "auto";
  triggerClassName?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ALL = [...COMPARISON_OPS, ...ARITH_OPS];
  const current = ALL.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          className={cn(
            "w-auto h-6 bg-input px-1 text-xs inline-flex items-center rounded-md border border-input hover:bg-input/80",
            triggerClassName,
          )}
        >
          {current ? (
            <span>
              {triggerStyle === "label"
                ? current.label
                : triggerStyle === "auto"
                  ? COMPARISON_OPS.some((o) => o.value === value) ? current.label : current.symbol
                  : current.symbol}
            </span>
          ) : (
            // Match the unified picker: when the trigger has no operator
            // selected we render the Σ glyph bold (thicker stroke) and
            // tinted with the primary accent so every Σ trigger across the
            // row looks identical.
            <span className="inline-flex items-center">
              <Sigma className="h-4 w-4 text-orange-500" strokeWidth={3} />
            </span>
          )}
        </button>
      </PopoverTrigger>
      {/* Panel layout mirrors ConditionOperatorPicker exactly so every Σ
          trigger across the app opens the same-looking dropdown: search
          input → "Operation Panel" header → "Remove all on right" row →
          ARITHMETIC OPERATIONS (bold symbols, muted labels) →
          COMPARISON OPERATIONS. The `actionable` prop still controls
          which sections are clickable (others render disabled), and
          `allowNone` only changes whether the — none — row is enabled. */}
      <PopoverContent className="w-[18rem] p-0" align="start" avoidCollisions={true} collisionPadding={8}>
        <Command>
          <CommandInput placeholder="Search operation..." className="h-6 text-xs" />
          <div className="px-3 pt-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground border-b">
            Operation Panel
          </div>
          <CommandList className="max-h-[280px]">
            <CommandEmpty>No operation found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="none remove all on right reset clear"
                disabled={!allowNone}
                onSelect={() => {
                  if (!allowNone) return;
                  onChange("");
                  setOpen(false);
                }}
                className="text-xs"
              >
                <Sigma className="h-4 w-4 inline mr-1.5 text-orange-500" strokeWidth={3} />
                <span className="font-bold">−None−</span>
              </CommandItem>
            </CommandGroup>
            <CommandGroup
              heading="Arithmetic Operations"
              className="[&_[cmdk-group-heading]]:text-primary [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[10px]"
            >
              {ARITH_OPS.map((o) => {
                const enabled = actionable.includes("arithmetic");
                return (
                  <CommandItem
                    key={o.value}
                    value={`${o.symbol} ${o.label}`}
                    disabled={!enabled}
                    onSelect={() => {
                      if (!enabled) return;
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    <span className="font-mono font-bold text-base inline-block w-5 text-center">
                      {o.symbol}
                    </span>
                    <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">
                      {o.label}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandGroup
              heading="Comparison Operations"
              className="[&_[cmdk-group-heading]]:text-primary [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[10px]"
            >
              {COMPARISON_OPS.map((o) => {
                const enabled = actionable.includes("comparison");
                return (
                  <CommandItem
                    key={o.value}
                    value={`${o.symbol} ${o.label}`}
                    disabled={!enabled}
                    onSelect={() => {
                      if (!enabled) return;
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    <span className="font-mono inline-block w-5 text-center">{o.symbol}</span>
                    <span className="ml-1.5 font-bold">{o.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Unified per-condition operator picker. Replaces both the old "wrap left
 * leaf with Σ" button and the standalone comparison-op dropdown with a
 * SINGLE trigger that:
 *   • Shows a Σ icon when the user has selected "— none —" / "Remove all
 *     on right" (the empty / placeholder state).
 *   • Otherwise shows the symbol or short label of whichever operator the
 *     user last picked — `+`, `−`, `×`, `÷` for arithmetic, or "greater
 *     than" / "less than" / etc. for comparison.
 *
 * The dropdown panel is the one panel from the user's mock: a "Select an
 * operation" header, "Remove all on right" reset row, then "Arithmetic
 * Operations" and "Comparison Operations" sections. Picking an arithmetic
 * op wraps `condition.left` into a binop (or replaces the binop's op if
 * it's already wrapped); picking a comparison op sets `condition.op`;
 * picking "Remove all on right" resets `condition.right` to a fresh
 * placeholder leaf and reverts the trigger back to Σ.
 */
function ConditionOperatorPicker({
  condition,
  onChange,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
}) {
  // Local UI state for what the trigger displays. We can't derive this
  // from the data alone because both an arithmetic pick (which wraps
  // `left`) and a comparison pick (which updates `op`) are valid at the
  // same time — the trigger should reflect whichever the user chose most
  // recently. Initialised from the stored comparison op so existing
  // conditions render their op label up front.
  const [displayOp, setDisplayOp] = useState<string>(condition.op);
  // Re-sync if the stored comparison op changes from outside (e.g. a
  // duplicate-row action or external state reset).
  useEffect(() => {
    setDisplayOp(condition.op);
  }, [condition.op]);

  const ALL = [...COMPARISON_OPS, ...ARITH_OPS];
  const current = ALL.find((o) => o.value === displayOp);

  const handlePick = (raw: string) => {
    if (raw === "__none__") {
      // "Remove all on right" — clear the right-hand expression back to
      // a fresh placeholder leaf and put the trigger back to Σ.
      setDisplayOp("");
      onChange({ ...condition, op: "", right: newLeafExpr({ kind: "number", value: 20 }) });
      return;
    }
    if (COMPARISON_OPS.some((o) => o.value === raw)) {
      setDisplayOp(raw);
      // If currently in arithmetic mode (op="") and left is a wrapped binop,
      // unwrap it: restore left.a as left and left.b as right so we don't duplicate.
      if (condition.op === "" && condition.left.type === "binop") {
        onChange({ ...condition, op: raw as Operator, left: condition.left.a, right: condition.left.b });
      } else {
        onChange({ ...condition, op: raw as Operator });
      }
      return;
    }
    // Arithmetic op: wrap left leaf into a binop, or replace the existing
    // top-level binop's op if left is already wrapped.
    // Do NOT update displayOp — the button stays as Σ (or the current
    // comparison op) since the arithmetic symbol is already visible between
    // the left-side terms.
    const op = raw as ArithOp;
    // When a comparison was active, preserve its right-side expression as the
    // second operand of the new arithmetic (so EMA(Close,20) is kept, not lost).
    // When no comparison was active, fall back to a fresh Number(20).
    const bExpr: Expr = condition.op !== "" ? condition.right : newLeafExpr({ kind: "number", value: 20 });
    const newLeft: Expr =
      condition.left.type === "binop"
        ? { ...condition.left, op }
        : { type: "binop", op, a: condition.left, b: bExpr };
    setDisplayOp("");
    onChange({ ...condition, left: newLeft, op: "" });
  };

  const nameMode = useContext(NameModeContext);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Select an operation"
          className="w-auto h-6 bg-input px-1 text-xs inline-flex items-center rounded-md border border-input hover:bg-input/80"
        >
          {current ? (
            // Arithmetic ops show their symbol (compact); comparison ops
            // show the long label (or short label in short mode).
            <span>
              {COMPARISON_OPS.some((o) => o.value === displayOp)
                ? (nameMode === "short" && (current as typeof COMPARISON_OPS[0]).shortLabel) || current.label
                : current.symbol}
            </span>
          ) : (
            // Σ-only state: the trigger button itself stays neutral, but
            // the Sigma glyph is rendered bold (thicker stroke) and tinted
            // with the primary accent so it pops without colouring the
            // surrounding chrome.
            <span className="inline-flex items-center">
              <Sigma className="h-4 w-4 text-orange-500" strokeWidth={3} />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[18rem] p-0" align="start" avoidCollisions={true} collisionPadding={8}>
        <Command>
          <CommandInput placeholder="Search operation..." className="h-6 text-xs" />
          <div className="px-3 pt-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground border-b">
            Operation Panel
          </div>
          <CommandList className="max-h-[280px]">
            <CommandEmpty>No operation found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="none remove all on right reset clear"
                onSelect={() => {
                  handlePick("__none__");
                  setOpen(false);
                }}
                className="text-xs"
              >
                <Sigma className="h-4 w-4 inline mr-1.5 text-orange-500" strokeWidth={3} />
                <span className="font-bold">−None−</span>
              </CommandItem>
            </CommandGroup>
            <CommandGroup
              heading="Arithmetic Operations"
              className="[&_[cmdk-group-heading]]:text-primary [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[10px]"
            >
              {ARITH_OPS.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.symbol} ${o.label}`}
                  onSelect={() => {
                    handlePick(o.value);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  {/* Arithmetic rows: lead with a bold, prominent symbol so the
                      operator is the visual anchor; render the word next to it
                      in a smaller, muted style as a secondary hint. */}
                  <span className="font-mono font-bold text-base inline-block w-5 text-center">
                    {o.symbol}
                  </span>
                  <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">
                    {o.label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup
              heading="Comparison Operations"
              className="[&_[cmdk-group-heading]]:text-primary [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[10px]"
            >
              {COMPARISON_OPS.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.symbol} ${o.label}`}
                  onSelect={() => {
                    handlePick(o.value);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <span className="font-mono inline-block w-5 text-center">{o.symbol}</span>
                  <span className="ml-1.5 font-bold">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function defaultLeaf(kind: IndKind): LeafIndicator {
  switch (kind) {
    case "open": return { kind: "open" };
    case "high": return { kind: "high" };
    case "low": return { kind: "low" };
    case "close": return { kind: "close" };
    case "volume": return { kind: "volume" };
    case "prev_close": return { kind: "prev_close" };
    case "change_pct": return { kind: "change_pct" };
    case "hl2":   return { kind: "hl2" };
    case "hlc3":  return { kind: "hlc3" };
    case "ohlc4": return { kind: "ohlc4" };
    case "price": return { kind: "price", field: "close" };
    case "sma": return { kind: "sma", period: 20, source: { kind: "close" } };
    case "ema": return { kind: "ema", period: 20, source: { kind: "close" } };
    case "wma": return { kind: "wma", period: 20, source: { kind: "close" } };
    case "rsi": return { kind: "rsi", period: 14 };
    case "williams_r": return { kind: "williams_r", period: 14 };
    case "cci": return { kind: "cci", period: 20 };
    case "atr": return { kind: "atr", period: 14 };
    case "high_n": return { kind: "high_n", period: 252 };
    case "low_n": return { kind: "low_n", period: 252 };
    case "macd": return { kind: "macd", fast: 12, slow: 26, signal: 9, part: "line" };
    case "bbands": return { kind: "bbands", period: 20, mult: 2, part: "mid" };
    case "bb_pctb": return { kind: "bb_pctb", period: 20, mult: 2 };
    case "donchian": return { kind: "donchian", period: 20, part: "mid" };
    case "supertrend": return { kind: "supertrend", period: 10, mult: 3 };
    case "halftrend": return { kind: "halftrend", amplitude: 2, channel: 2 };
    case "halftrend_bull": return { kind: "halftrend_bull", amplitude: 2, channel: 2 };
    case "halftrend_bear": return { kind: "halftrend_bear", amplitude: 2, channel: 2 };
    case "camarilla": return { kind: "camarilla", level: 1, side: "R" };
    case "alma": return { kind: "alma", period: 9, offset: 0.85, sigma: 6, source: { kind: "close" } };
    case "hma": return { kind: "hma", period: 20, source: { kind: "close" } };
    case "smma": return { kind: "smma", period: 7, source: { kind: "close" } };
    case "lsma": return { kind: "lsma", length: 25, offset: 0, source: { kind: "close" } };
    case "kama": return { kind: "kama", period: 10, source: { kind: "close" } };
    case "hamming": return { kind: "hamming", period: 10, source: { kind: "close" } };
    case "jma": return { kind: "jma", length: 7, phase: 50, power: 2, source: { kind: "close" } };
    case "mac": return { kind: "mac", upperLen: 20, lowerLen: 20, upperOffset: 0, lowerOffset: 0, part: "upper" };
    case "vwap": return { kind: "vwap", period: 20 };
    case "mfi": return { kind: "mfi", period: 14 };
    case "adx": return { kind: "adx", period: 14 };
    case "dmi": return { kind: "dmi", diLen: 14, adxSmooth: 14, part: "adx" };
    case "aroon": return { kind: "aroon", period: 14, part: "up" };
    case "ladder_atr": return { kind: "ladder_atr", maType: "hma", maLen: 7, mult: 4, part: "upper" };
    case "chandelier": return { kind: "chandelier", length: 22, atrLen: 22, mult: 3, part: "long" };
    case "atr_ts": return { kind: "atr_ts", atrPeriod: 5, hhvPeriod: 10, mult: 2.5 };
    case "stoch_rsi": return { kind: "stoch_rsi", rsiLen: 14, stochLen: 14, smoothK: 3, smoothD: 3, part: "k" };
    case "psar": return { kind: "psar", start: 0.02, increment: 0.02, max: 0.2 };
    case "cpr": return { kind: "cpr", part: "pivot" };
    case "ichimoku": return { kind: "ichimoku", tenkan: 9, kijun: 26, senkouB: 52, displacement: 26, part: "tenkan" };
    case "vwma": return { kind: "vwma", period: 20 };
    case "keltner": return { kind: "keltner", period: 20, mult: 2, part: "mid" };
    case "stoch": return { kind: "stoch", period: 14, smoothK: 1, smooth: 3, part: "k" };
    case "obv": return { kind: "obv", smoothType: "SMA", smoothLen: 9, part: "obv" };
    case "cmf": return { kind: "cmf", period: 20 };
    case "dpo": return { kind: "dpo", period: 20 };
    case "trad_pivot": return { kind: "trad_pivot", part: "P" };
    case "fib_pivot": return { kind: "fib_pivot", part: "P" };
    case "woodie_pivot": return { kind: "woodie_pivot", part: "P" };
    case "classic_pivot": return { kind: "classic_pivot", part: "P" };
    case "pattern": return { kind: "pattern", name: "doji" };
    case "number": return { kind: "number", value: 20 };
    case "bracket": return { kind: "bracket", expr: newLeafExpr({ kind: "close" }) };
  }
}

// Renders a single leaf indicator picker button + popover (reused for left and right sides).
function SrcLeafPicker({ leaf, onSelect }: { leaf: LeafIndicator; onSelect: (l: LeafIndicator) => void }) {
  const [open, setOpen] = useState(false);
  const label = KINDS.find((k) => k.value === leaf.kind)?.label ?? leaf.kind;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="h-6 px-2 rounded-md bg-input text-xs inline-flex items-center border border-input hover:bg-input/80 whitespace-nowrap w-auto focus-visible:outline-none">
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[18rem] p-0" align="start" avoidCollisions={true} collisionPadding={8}>
        <Command>
          <CommandInput placeholder="Search source indicator..." className="h-6 text-xs" />
          <div className="px-3 pt-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground border-b">Indicator Panel</div>
          <CommandList className="max-h-[280px]">
            <CommandEmpty>No indicator found.</CommandEmpty>
            {IND_SECTIONS.map((sec, si) => sec.categories.map((cat) => (
              <CommandGroup key={`${si}-${cat.heading}`} heading={cat.heading}>
                {cat.items.filter((item) => item.value !== "bracket").map((item) => (
                  <CommandItem key={item.value} value={`${item.short} ${item.full ?? ""}`}
                    onSelect={() => { onSelect(defaultLeaf(item.value as IndKind)); setOpen(false); }}
                    className="text-xs">
                    <span className="font-bold mr-1">{item.short}</span>
                    {item.full && <span className="text-muted-foreground/70">({item.full})</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Flatten a SrcExpr tree into a linear chain for rendering.
// e.g. srcBinop(a, "+", srcBinop(b, "×", c)) → [{leaf:a, op:"+"}, {leaf:b, op:"×"}, {leaf:c}]
type SrcChainItem = { leaf: LeafIndicator; op?: string };
function srcExprToChain(src: SrcExpr): SrcChainItem[] {
  if (!("type" in src) || src.type !== "srcBinop") return [{ leaf: src as LeafIndicator }];
  return [{ leaf: src.a, op: src.op }, ...srcExprToChain(src.b)];
}
// Rebuild SrcExpr from a flat chain (right-associative).
function chainToSrcExpr(chain: SrcChainItem[]): SrcExpr {
  if (chain.length === 0) return { kind: "close" };
  if (chain.length === 1 || !chain[0].op) return chain[0].leaf;
  return { type: "srcBinop", op: chain[0].op, a: chain[0].leaf, b: chainToSrcExpr(chain.slice(1)) };
}

// Mirrors ConditionOperatorPicker: each Σ opens Operation Panel.
// Selecting an op appends Number(20) and a new Σ; −None− truncates the chain.
function MaSourcePicker({ source, onChange }: { source: SrcExpr; onChange: (s: SrcExpr) => void }) {
  const chain = srcExprToChain(source);
  return (
    <>
      {chain.map((item, idx) => {
        const isLast = idx === chain.length - 1;
        return (
          <Fragment key={idx}>
            <SrcLeafPicker leaf={item.leaf} onSelect={(l) => {
              const next = chain.map((c, i) => i === idx ? { ...c, leaf: l } : c);
              onChange(chainToSrcExpr(next));
            }} />
            <SourceParamEditor source={item.leaf} onChange={(l) => {
              const next = chain.map((c, i) => i === idx ? { ...c, leaf: l } : c);
              onChange(chainToSrcExpr(next));
            }} />
            <OperatorPicker
              value={item.op ?? ""}
              onChange={(newOp) => {
                if (!newOp) {
                  // −None−: truncate chain to this item, clear its op
                  const next = chain.slice(0, idx + 1).map((c, i) =>
                    i === idx ? { ...c, op: undefined } : c
                  );
                  onChange(chainToSrcExpr(next));
                } else {
                  // Set op on this item; if it was the last, append Number(20)
                  let next = chain.map((c, i) => i === idx ? { ...c, op: newOp } : c);
                  if (isLast) next = [...next, { leaf: { kind: "number", value: 20 } as LeafIndicator }];
                  onChange(chainToSrcExpr(next));
                }
              }}
              actionable={["arithmetic", "comparison"]}
              allowNone={true}
              triggerStyle="auto"
              triggerClassName="min-w-0 w-auto px-1"
              title="Source operation"
            />
          </Fragment>
        );
      })}
    </>
  );
}

// Renders inline editable params for whatever indicator is chosen as an MA source.
// Price-like sources (close/open/hl2 etc.) render nothing.
function SourceParamEditor({ source, onChange }: { source: LeafIndicator; onChange: (s: LeafIndicator) => void }) {
  const PRICE_KINDS = new Set(["close","open","high","low","hl2","hlc3","ohlc4","prev_close","change_pct","volume","price","pattern","bracket"]);
  if (PRICE_KINDS.has(source.kind)) return null;
  switch (source.kind) {
    case "number":
      return <ParamInput mode="float" fallback={20} value={source.value}
        onChange={(n) => onChange({ ...source, value: n })} />;
    case "sma": case "ema": case "wma": case "rsi": case "williams_r": case "cci": case "atr":
    case "high_n": case "low_n": case "hma": case "smma": case "kama": case "hamming":
    case "vwap": case "mfi": case "adx": case "vwma": case "cmf": case "dpo":
      return <ParamInput mode="int" min={1} fallback={source.period} value={source.period}
        onChange={(n) => onChange({ ...source, period: n })} />;
    case "jma":
      return <>
        <ParamInput mode="int" min={1} fallback={7} value={source.length} onChange={(n) => onChange({ ...source, length: n })} />
        <ParamInput mode="int" min={-100} max={100} fallback={50} value={source.phase} onChange={(n) => onChange({ ...source, phase: n })} />
        <ParamInput mode="int" min={1} fallback={2} value={source.power} onChange={(n) => onChange({ ...source, power: n })} />
      </>;
    case "lsma":
      return <>
        <ParamInput mode="int" min={1} fallback={25} value={source.length} onChange={(n) => onChange({ ...source, length: n })} />
        <ParamInput mode="int" min={0} fallback={0} value={source.offset} onChange={(n) => onChange({ ...source, offset: n })} />
      </>;
    case "alma":
      return <>
        <ParamInput mode="int" min={1} fallback={9} value={source.period} onChange={(n) => onChange({ ...source, period: n })} />
        <ParamInput mode="float" step="0.05" min={0} max={1} fallback={0.85} value={source.offset} onChange={(n) => onChange({ ...source, offset: n })} />
        <ParamInput mode="float" step="0.5" min={0} fallback={6} value={source.sigma} onChange={(n) => onChange({ ...source, sigma: n })} />
      </>;
    case "macd":
      return <>
        <ParamInput mode="int" min={1} fallback={12} value={source.fast} onChange={(n) => onChange({ ...source, fast: n })} />
        <ParamInput mode="int" min={1} fallback={26} value={source.slow} onChange={(n) => onChange({ ...source, slow: n })} />
        <ParamInput mode="int" min={1} fallback={9} value={source.signal} onChange={(n) => onChange({ ...source, signal: n })} />
      </>;
    case "bbands":
      return <>
        <ParamInput mode="int" min={1} fallback={20} value={source.period} onChange={(n) => onChange({ ...source, period: n })} />
        <ParamInput mode="float" step="0.1" min={0} fallback={2} value={source.mult} onChange={(n) => onChange({ ...source, mult: n })} />
      </>;
    case "bb_pctb":
      return <>
        <ParamInput mode="int" min={1} fallback={20} value={source.period} onChange={(n) => onChange({ ...source, period: n })} />
        <ParamInput mode="float" step="0.1" min={0} fallback={2} value={source.mult} onChange={(n) => onChange({ ...source, mult: n })} />
      </>;
    case "donchian":
      return <ParamInput mode="int" min={1} fallback={20} value={source.period} onChange={(n) => onChange({ ...source, period: n })} />;
    case "supertrend":
      return <>
        <ParamInput mode="int" min={1} fallback={10} value={source.period} onChange={(n) => onChange({ ...source, period: n })} />
        <ParamInput mode="float" step="0.1" min={0} fallback={3} value={source.mult} onChange={(n) => onChange({ ...source, mult: n })} />
      </>;
    case "halftrend":
    case "halftrend_bull":
    case "halftrend_bear":
      return <>
        <ParamInput mode="int" min={1} fallback={2} value={source.amplitude} onChange={(n) => onChange({ ...source, amplitude: n })} />
        <ParamInput mode="int" min={1} fallback={2} value={source.channel} onChange={(n) => onChange({ ...source, channel: n })} />
      </>;
    case "keltner":
      return <>
        <ParamInput mode="int" min={1} fallback={20} value={source.period} onChange={(n) => onChange({ ...source, period: n })} />
        <ParamInput mode="float" step="0.1" min={0} fallback={2} value={source.mult} onChange={(n) => onChange({ ...source, mult: n })} />
      </>;
    case "stoch":
      return <>
        <ParamInput mode="int" min={1} fallback={14} value={source.period} onChange={(n) => onChange({ ...source, period: n })} />
        <ParamInput mode="int" min={1} fallback={1} value={source.smoothK} onChange={(n) => onChange({ ...source, smoothK: n })} />
        <ParamInput mode="int" min={1} fallback={3} value={source.smooth} onChange={(n) => onChange({ ...source, smooth: n })} />
      </>;
    case "stoch_rsi":
      return <>
        <ParamInput mode="int" min={1} fallback={14} value={source.rsiLen} onChange={(n) => onChange({ ...source, rsiLen: n })} />
        <ParamInput mode="int" min={1} fallback={14} value={source.stochLen} onChange={(n) => onChange({ ...source, stochLen: n })} />
        <ParamInput mode="int" min={1} fallback={3} value={source.smoothK} onChange={(n) => onChange({ ...source, smoothK: n })} />
        <ParamInput mode="int" min={1} fallback={3} value={source.smoothD} onChange={(n) => onChange({ ...source, smoothD: n })} />
      </>;
    case "dmi":
      return <>
        <ParamInput mode="int" min={1} fallback={14} value={source.diLen} onChange={(n) => onChange({ ...source, diLen: n })} />
        <ParamInput mode="int" min={1} fallback={14} value={source.adxSmooth} onChange={(n) => onChange({ ...source, adxSmooth: n })} />
      </>;
    case "aroon":
      return <ParamInput mode="int" min={1} fallback={14} value={source.period} onChange={(n) => onChange({ ...source, period: n })} />;
    case "obv":
      return <ParamInput mode="int" min={1} fallback={9} value={source.smoothLen} onChange={(n) => onChange({ ...source, smoothLen: n })} />;
    case "ichimoku":
      return <>
        <ParamInput mode="int" min={1} fallback={9} value={source.tenkan} onChange={(n) => onChange({ ...source, tenkan: n })} />
        <ParamInput mode="int" min={1} fallback={26} value={source.kijun} onChange={(n) => onChange({ ...source, kijun: n })} />
        <ParamInput mode="int" min={1} fallback={52} value={source.senkouB} onChange={(n) => onChange({ ...source, senkouB: n })} />
        <ParamInput mode="int" min={1} fallback={26} value={source.displacement} onChange={(n) => onChange({ ...source, displacement: n })} />
      </>;
    case "atr_ts":
      return <>
        <ParamInput mode="int" min={1} fallback={5} value={source.atrPeriod} onChange={(n) => onChange({ ...source, atrPeriod: n })} />
        <ParamInput mode="int" min={1} fallback={10} value={source.hhvPeriod} onChange={(n) => onChange({ ...source, hhvPeriod: n })} />
        <ParamInput mode="float" step="0.1" min={0} fallback={2.5} value={source.mult} onChange={(n) => onChange({ ...source, mult: n })} />
      </>;
    case "chandelier":
      return <>
        <ParamInput mode="int" min={1} fallback={22} value={source.length} onChange={(n) => onChange({ ...source, length: n })} />
        <ParamInput mode="int" min={1} fallback={22} value={source.atrLen} onChange={(n) => onChange({ ...source, atrLen: n })} />
        <ParamInput mode="float" step="0.1" min={0} fallback={3} value={source.mult} onChange={(n) => onChange({ ...source, mult: n })} />
      </>;
    case "ladder_atr":
      return <>
        <ParamInput mode="int" min={1} fallback={7} value={source.maLen} onChange={(n) => onChange({ ...source, maLen: n })} />
        <ParamInput mode="float" step="0.1" min={0} fallback={4} value={source.mult} onChange={(n) => onChange({ ...source, mult: n })} />
      </>;
    case "psar":
      return <>
        <ParamInput mode="float" step="0.01" min={0} fallback={0.02} value={source.start} onChange={(n) => onChange({ ...source, start: n })} />
        <ParamInput mode="float" step="0.01" min={0} fallback={0.02} value={source.increment} onChange={(n) => onChange({ ...source, increment: n })} />
        <ParamInput mode="float" step="0.1" min={0} fallback={0.2} value={source.max} onChange={(n) => onChange({ ...source, max: n })} />
      </>;
    case "mac":
      return <>
        <ParamInput mode="int" min={1} fallback={20} value={source.upperLen} onChange={(n) => onChange({ ...source, upperLen: n })} />
        <ParamInput mode="int" min={1} fallback={20} value={source.lowerLen} onChange={(n) => onChange({ ...source, lowerLen: n })} />
      </>;
    default:
      return null;
  }
}

function IndicatorPicker({ value, onChange }: { value: IndKind; onChange: (k: IndKind) => void }) {
  const [open, setOpen] = useState(false);
  const current = KINDS.find((k) => k.value === value);
  const nameMode = useContext(NameModeContext);
  const displayLabel = nameMode === "short"
    ? (KINDS_SHORT[value] ?? current?.label ?? value)
    : (current?.label ?? value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-6 px-2 rounded-md bg-input text-xs inline-flex items-center border border-input hover:bg-input/80 whitespace-nowrap w-auto"
        >
          <span>{displayLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start" avoidCollisions={true} collisionPadding={8}>
        <Command>
          <CommandInput placeholder="Search indicator..." className="h-6 text-xs" />
          <div className="px-3 pt-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground border-b">
            Indicator Panel
          </div>
          <CommandList className="max-h-[280px]">
            <CommandEmpty>No indicator found.</CommandEmpty>
            {IND_SECTIONS.map((sec, si) => (
              <Fragment key={sec.section ?? `sec-${si}`}>
                {sec.section && (
                  <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-foreground border-t first:border-t-0">
                    {sec.section}
                  </div>
                )}
                {sec.categories.map((cat) => (
                  <CommandGroup
                    key={cat.heading}
                    heading={cat.heading}
                    className="[&_[cmdk-group-heading]]:text-primary [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[10px]"
                  >
                    {cat.items.map((it) => (
                      <CommandItem
                        key={it.value}
                        value={`${it.short} ${it.full ?? ""}`.trim()}
                        onSelect={() => { onChange(it.value); setOpen(false); }}
                        className="text-xs"
                      >
                        <span className="font-semibold">{it.short}</span>
                        {it.full && (
                          <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                            ({it.full})
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </Fragment>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function LeafEditor({ value, onChange }: { value: Extract<Expr, { type: "leaf" }>; onChange: (e: Expr) => void }) {
  const ind = value.ind;
  const update = (next: Partial<Extract<Expr, { type: "leaf" }>>) => onChange({ ...value, ...next });
  const updateInd = (next: LeafIndicator) => onChange({ ...value, ind: next });

  return (
    <div className="flex flex-wrap gap-1 items-center bg-secondary/40 rounded-md px-1.5 py-0.5">
      {/* Combined Timeframe + N periods-ago picker — hidden for plain Number.
          The dropdown shows grouped options per timeframe (Daily candles,
          Weekly candles, etc.) with presets (current, 1, 2, 3 ago) plus an
          "n X ago" entry that reveals an inline input for any custom N. */}
      {ind.kind !== "number" && ind.kind !== "bracket" && (
        <TimeframePicker
          tf={value.tf}
          daysAgo={value.daysAgo}
          onChange={(tf, daysAgo) => update({ tf: tf as Timeframe, daysAgo })}
        />
      )}
      {ind.kind !== "number" && ind.kind !== "bracket" && isIntradayTf(value.tf) && (
        <span className="text-[10px] text-orange-400 ml-1">
          ⚠ Intraday data not loaded — condition will always be false
        </span>
      )}
      {/* Candle source toggle (Regular vs Heikin-Ashi) — hidden for plain Number and Bracket */}
      {ind.kind !== "number" && ind.kind !== "bracket" && (
        <div className="inline-flex rounded-md border border-border bg-input p-[1px] h-6" title="Candle source for this indicator">
          {(["regular", "ha"] as CandleKind[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => update({ candle: c })}
              className={`px-1.5 text-[10px] font-semibold rounded-sm transition-colors ${
                value.candle === c
                  ? c === "ha"
                    ? "bg-accent text-accent-foreground"
                    : "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c === "ha" ? "H-A" : "Reg"}
            </button>
          ))}
        </div>
      )}
      <IndicatorPicker value={ind.kind} onChange={(k) => updateInd(defaultLeaf(k))} />
      {ind.kind === "price" && (
        <Select value={ind.field} onValueChange={(f) => updateInd({ kind: "price", field: f as "open" })}>
          <SelectTrigger className="w-[120px] h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["open","high","low","close","volume","prev_close","change_pct"].map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {(ind.kind === "sma" || ind.kind === "ema" || ind.kind === "wma" || ind.kind === "hma" || ind.kind === "smma" || ind.kind === "kama" || ind.kind === "hamming") && (
        <>
          <span className="text-xs text-muted-foreground font-mono">(</span>
          <MaSourcePicker
            source={ind.source ?? { kind: "close" }}
            onChange={(s) => updateInd({ ...ind, source: s } as LeafIndicator)}
          />
          <span className="text-xs text-muted-foreground">,</span>
          <ParamInput mode="int" min={1} fallback={ind.period} value={ind.period}
            onChange={(n) => updateInd({ ...ind, period: n } as LeafIndicator)} />
          <span className="text-xs text-muted-foreground font-mono">)</span>
        </>
      )}
      {(ind.kind === "rsi" || ind.kind === "williams_r" || ind.kind === "cci" || ind.kind === "atr" || ind.kind === "high_n" || ind.kind === "low_n" || ind.kind === "vwap" || ind.kind === "mfi" || ind.kind === "adx" || ind.kind === "vwma" || ind.kind === "cmf" || ind.kind === "dpo") && (
        <ParamInput mode="int" min={1} fallback={ind.period} value={ind.period}
          onChange={(n) => updateInd({ ...ind, period: n } as LeafIndicator)} />
      )}
      {ind.kind === "lsma" && (
        <>
          <span className="text-xs text-muted-foreground font-mono">(</span>
          <MaSourcePicker
            source={ind.source ?? { kind: "close" }}
            onChange={(s) => updateInd({ ...ind, source: s })}
          />
          <span className="text-xs text-muted-foreground">,</span>
          <ParamInput mode="int" min={1} fallback={25} value={ind.length}
            onChange={(n) => updateInd({ ...ind, length: n })} />
          <ParamInput mode="int" min={0} fallback={0} value={ind.offset}
            onChange={(n) => updateInd({ ...ind, offset: n })} />
          <span className="text-xs text-muted-foreground font-mono">)</span>
        </>
      )}
      {ind.kind === "mac" && (
        <>
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "upper" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="upper">Upper</SelectItem>
              <SelectItem value="lower">Lower</SelectItem>
            </SelectContent>
          </Select>
          <ParamInput mode="int" min={1} fallback={20} value={ind.upperLen}
            onChange={(n) => updateInd({ ...ind, upperLen: n })} />
          <ParamInput mode="int" min={1} fallback={20} value={ind.lowerLen}
            onChange={(n) => updateInd({ ...ind, lowerLen: n })} />
          <ParamInput mode="float" fallback={0} value={ind.upperOffset}
            onChange={(n) => updateInd({ ...ind, upperOffset: n })} />
          <ParamInput mode="float" fallback={0} value={ind.lowerOffset}
            onChange={(n) => updateInd({ ...ind, lowerOffset: n })} />
        </>
      )}
      {ind.kind === "jma" && (
        <>
          <span className="text-xs text-muted-foreground font-mono">(</span>
          <MaSourcePicker
            source={ind.source ?? { kind: "close" }}
            onChange={(s) => updateInd({ ...ind, source: s })}
          />
          <span className="text-xs text-muted-foreground">,</span>
          <ParamInput mode="int" min={1} fallback={7} value={ind.length}
            onChange={(n) => updateInd({ ...ind, length: n })} />
          <ParamInput mode="int" min={-100} max={100} fallback={50} value={ind.phase}
            onChange={(n) => updateInd({ ...ind, phase: n })} />
          <ParamInput mode="int" min={1} fallback={2} value={ind.power}
            onChange={(n) => updateInd({ ...ind, power: n })} />
          <span className="text-xs text-muted-foreground font-mono">)</span>
        </>
      )}
      {ind.kind === "atr_ts" && (
        <>
          <ParamInput mode="int" min={1} fallback={5} value={ind.atrPeriod}
            onChange={(n) => updateInd({ ...ind, atrPeriod: n })} />
          <ParamInput mode="int" min={1} fallback={10} value={ind.hhvPeriod}
            onChange={(n) => updateInd({ ...ind, hhvPeriod: n })} />
          <ParamInput mode="float" min={0.1} fallback={2.5} value={ind.mult}
            onChange={(n) => updateInd({ ...ind, mult: n })} />
        </>
      )}
      {ind.kind === "chandelier" && (
        <>
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "long" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="long">Long</SelectItem>
              <SelectItem value="short">Short</SelectItem>
            </SelectContent>
          </Select>
          <ParamInput mode="int" min={1} fallback={22} value={ind.length}
            onChange={(n) => updateInd({ ...ind, length: n })} />
          <ParamInput mode="int" min={1} fallback={22} value={ind.atrLen}
            onChange={(n) => updateInd({ ...ind, atrLen: n })} />
          <ParamInput mode="float" min={0.1} fallback={3} value={ind.mult}
            onChange={(n) => updateInd({ ...ind, mult: n })} />
        </>
      )}
      {ind.kind === "ladder_atr" && (
        <>
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "upper" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="upper">Upper</SelectItem>
              <SelectItem value="lower">Lower</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ind.maType} onValueChange={(p) => updateInd({ ...ind, maType: p as "hma" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sma">sma</SelectItem>
              <SelectItem value="ema">ema</SelectItem>
              <SelectItem value="wma">wma</SelectItem>
              <SelectItem value="hma">hma</SelectItem>
              <SelectItem value="rma">rma</SelectItem>
            </SelectContent>
          </Select>
          <ParamInput mode="int" min={1} fallback={7} value={ind.maLen}
            onChange={(n) => updateInd({ ...ind, maLen: n })} />
          <ParamInput mode="float" min={0.1} fallback={4} value={ind.mult}
            onChange={(n) => updateInd({ ...ind, mult: n })} />
        </>
      )}
      {ind.kind === "stoch_rsi" && (
        <>
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "k" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="k">%K</SelectItem>
              <SelectItem value="d">%D</SelectItem>
            </SelectContent>
          </Select>
          <ParamInput mode="int" min={1} fallback={14} value={ind.rsiLen}
            onChange={(n) => updateInd({ ...ind, rsiLen: n })} />
          <ParamInput mode="int" min={1} fallback={14} value={ind.stochLen}
            onChange={(n) => updateInd({ ...ind, stochLen: n })} />
          <ParamInput mode="int" min={1} fallback={3} value={ind.smoothK}
            onChange={(n) => updateInd({ ...ind, smoothK: n })} />
          <ParamInput mode="int" min={1} fallback={3} value={ind.smoothD}
            onChange={(n) => updateInd({ ...ind, smoothD: n })} />
        </>
      )}
      {ind.kind === "aroon" && (
        <>
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "up" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="up">Up</SelectItem>
              <SelectItem value="down">Down</SelectItem>
            </SelectContent>
          </Select>
          <ParamInput mode="int" min={1} fallback={14} value={ind.period}
            onChange={(n) => updateInd({ ...ind, period: n })} />
        </>
      )}
      {ind.kind === "dmi" && (
        <>
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "+di" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="+di">+DI</SelectItem>
              <SelectItem value="-di">-DI</SelectItem>
              <SelectItem value="dx">DX</SelectItem>
              <SelectItem value="adx">ADX</SelectItem>
              <SelectItem value="adxr">ADXR</SelectItem>
            </SelectContent>
          </Select>
          <ParamInput mode="int" min={1} fallback={14} value={ind.diLen}
            onChange={(n) => updateInd({ ...ind, diLen: n })} />
          <ParamInput mode="int" min={1} fallback={14} value={ind.adxSmooth}
            onChange={(n) => updateInd({ ...ind, adxSmooth: n })} />
        </>
      )}
      {ind.kind === "macd" && (
        <>
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "line" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="line">Line</SelectItem>
              <SelectItem value="signal">Signal</SelectItem>
              <SelectItem value="hist">Histogram</SelectItem>
            </SelectContent>
          </Select>
          <ParamInput mode="int" min={1} fallback={12} value={ind.fast}
            onChange={(n) => updateInd({ ...ind, fast: n })} />
          <ParamInput mode="int" min={1} fallback={26} value={ind.slow}
            onChange={(n) => updateInd({ ...ind, slow: n })} />
          <ParamInput mode="int" min={1} fallback={9} value={ind.signal}
            onChange={(n) => updateInd({ ...ind, signal: n })} />
        </>
      )}
      {ind.kind === "bb_pctb" && (
        <>
          <ParamInput mode="int" min={1} fallback={20} value={ind.period}
            onChange={(n) => updateInd({ ...ind, period: n })} />
          <ParamInput mode="float" step="0.1" min={0} fallback={2} value={ind.mult}
            onChange={(n) => updateInd({ ...ind, mult: n })} />
        </>
      )}
      {ind.kind === "bbands" && (
        <>
          <ParamInput mode="int" min={1} fallback={20} value={ind.period}
            onChange={(n) => updateInd({ ...ind, period: n })} />
          <ParamInput mode="float" step="0.1" min={0} fallback={2} value={ind.mult}
            onChange={(n) => updateInd({ ...ind, mult: n })} />
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "mid" })}>
            <SelectTrigger className="w-[90px] h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{["upper","mid","lower"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </>
      )}
      {ind.kind === "donchian" && (
        <>
          <ParamInput mode="int" min={1} fallback={20} value={ind.period}
            onChange={(n) => updateInd({ ...ind, period: n })} />
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "mid" })}>
            <SelectTrigger className="w-[90px] h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{["upper","mid","lower"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </>
      )}
      {ind.kind === "supertrend" && (
        <>
          <ParamInput mode="int" min={1} fallback={10} value={ind.period}
            onChange={(n) => updateInd({ ...ind, period: n })} />
          <ParamInput mode="float" step="0.1" min={0} fallback={3} value={ind.mult}
            onChange={(n) => updateInd({ ...ind, mult: n })} />
        </>
      )}
      {(ind.kind === "halftrend" || ind.kind === "halftrend_bull" || ind.kind === "halftrend_bear") && (
        <>
          <ParamInput mode="int" min={1} fallback={2} value={ind.amplitude}
            title="Amplitude (default 2)"
            onChange={(n) => updateInd({ ...ind, amplitude: n })} />
          <ParamInput mode="float" step="0.1" min={0} fallback={2} value={ind.channel}
            title="Channel deviation (default 2)"
            onChange={(n) => updateInd({ ...ind, channel: n })} />
        </>
      )}
      {ind.kind === "camarilla" && (
        <>
          <Select
            value={ind.side === "P" ? "P" : `${ind.side}${ind.level}`}
            onValueChange={(v) => {
              if (v === "P") updateInd({ ...ind, side: "P" as "R" | "S" | "P" });
              else updateInd({ ...ind, side: v[0] as "R" | "S", level: parseInt(v[1]) as 1|2|3|4 });
            }}
          >
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["R4","R3","R2","R1","P","S1","S2","S3","S4"] as const).map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
      {ind.kind === "alma" && (
        <>
          <span className="text-xs text-muted-foreground font-mono">(</span>
          <MaSourcePicker
            source={ind.source ?? { kind: "close" }}
            onChange={(s) => updateInd({ ...ind, source: s })}
          />
          <span className="text-xs text-muted-foreground">,</span>
          <ParamInput mode="int" min={1} fallback={9} value={ind.period}
            title="Period (default 9)"
            onChange={(n) => updateInd({ ...ind, period: n })} />
          <ParamInput mode="float" step="0.05" min={0} max={1} fallback={0.85} value={ind.offset}
            title="Offset 0–1 (default 0.85)"
            onChange={(n) => updateInd({ ...ind, offset: n })} />
          <ParamInput mode="float" step="0.5" min={0} fallback={6} value={ind.sigma}
            title="Sigma (default 6)"
            onChange={(n) => updateInd({ ...ind, sigma: n })} />
          <span className="text-xs text-muted-foreground font-mono">)</span>
        </>
      )}
      {ind.kind === "psar" && (
        <>
          <ParamInput mode="float" step="0.01" min={0} fallback={0.02} value={ind.start}
            label="Start" onChange={(n) => updateInd({ ...ind, start: n })} />
          <ParamInput mode="float" step="0.01" min={0} fallback={0.02} value={ind.increment}
            label="Increment" onChange={(n) => updateInd({ ...ind, increment: n })} />
          <ParamInput mode="float" step="0.05" min={0} fallback={0.2} value={ind.max}
            label="Maximum" onChange={(n) => updateInd({ ...ind, max: n })} />
        </>
      )}
      {ind.kind === "cpr" && (
        <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "pivot" })}>
          <SelectTrigger className="w-[100px] h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pivot">Pivot</SelectItem>
            <SelectItem value="tc">TC (Top)</SelectItem>
            <SelectItem value="bc">BC (Bottom)</SelectItem>
          </SelectContent>
        </Select>
      )}
      {ind.kind === "ichimoku" && (
        <>
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "tenkan" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs">
              <span>{({ tenkan: "Tenkan", kijun: "Kijunsen", senkou_a: "Senkou A", senkou_b: "Senkou B", chikou: "Chikou" } as Record<string,string>)[ind.part]}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tenkan" textValue="Tenkan">Tenkan <span className="text-muted-foreground/50">(Conversion Line)</span></SelectItem>
              <SelectItem value="kijun" textValue="Kijunsen">Kijunsen <span className="text-muted-foreground/50">(Base Line)</span></SelectItem>
              <SelectItem value="senkou_a" textValue="Senkou A">Senkou A <span className="text-muted-foreground/50">(Leading Span A)</span></SelectItem>
              <SelectItem value="senkou_b" textValue="Senkou B">Senkou B <span className="text-muted-foreground/50">(Leading Span B)</span></SelectItem>
              <SelectItem value="chikou" textValue="Chikou">Chikou <span className="text-muted-foreground/50">(Lagging Span)</span></SelectItem>
            </SelectContent>
          </Select>
          <ParamInput mode="int" min={1} fallback={9}  value={ind.tenkan}
            onChange={(n) => updateInd({ ...ind, tenkan: n })} />
          <ParamInput mode="int" min={1} fallback={26} value={ind.kijun}
            onChange={(n) => updateInd({ ...ind, kijun: n })} />
          <ParamInput mode="int" min={1} fallback={52} value={ind.senkouB}
            onChange={(n) => updateInd({ ...ind, senkouB: n })} />
          <ParamInput mode="int" min={1} fallback={26} value={ind.displacement}
            onChange={(n) => updateInd({ ...ind, displacement: n })} />
        </>
      )}
      {ind.kind === "keltner" && (
        <>
          <ParamInput mode="int" min={1} fallback={20} value={ind.period}
            onChange={(n) => updateInd({ ...ind, period: n })} />
          <ParamInput mode="float" step="0.1" min={0} fallback={2} value={ind.mult}
            onChange={(n) => updateInd({ ...ind, mult: n })} />
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "mid" })}>
            <SelectTrigger className="w-[90px] h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{["upper","mid","lower"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </>
      )}
      {ind.kind === "stoch" && (
        <>
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "k" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="k">%K</SelectItem>
              <SelectItem value="d">%D</SelectItem>
            </SelectContent>
          </Select>
          <ParamInput mode="int" min={1} fallback={14} value={ind.period}
            onChange={(n) => updateInd({ ...ind, period: n })} />
          <ParamInput mode="int" min={1} fallback={1} value={ind.smoothK}
            onChange={(n) => updateInd({ ...ind, smoothK: n })} />
          <ParamInput mode="int" min={1} fallback={3} value={ind.smooth}
            onChange={(n) => updateInd({ ...ind, smooth: n })} />
        </>
      )}
      {ind.kind === "obv" && (
        <>
          <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "obv" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="obv">OBV</SelectItem>
              <SelectItem value="signal">Signal</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ind.smoothType} onValueChange={(p) => updateInd({ ...ind, smoothType: p as "SMA" })}>
            <SelectTrigger className="w-auto h-6 bg-input text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SMA">SMA</SelectItem>
              <SelectItem value="EMA">EMA</SelectItem>
              <SelectItem value="SMMA">SMMA</SelectItem>
              <SelectItem value="WMA">WMA</SelectItem>
            </SelectContent>
          </Select>
          <ParamInput mode="int" min={1} fallback={9} value={ind.smoothLen}
            onChange={(n) => updateInd({ ...ind, smoothLen: n })} />
        </>
      )}
      {(ind.kind === "trad_pivot" || ind.kind === "fib_pivot" || ind.kind === "woodie_pivot" || ind.kind === "classic_pivot") && (
        <Select value={ind.part} onValueChange={(p) => updateInd({ ...ind, part: p as "P" })}>
          <SelectTrigger className="w-[80px] h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["R3","R2","R1","P","S1","S2","S3"] as const).map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {ind.kind === "pattern" && (
        <Select value={ind.name} onValueChange={(n) => updateInd({ kind: "pattern", name: n as "doji" })}>
          <SelectTrigger className="w-[170px] h-8 bg-input text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[
              { v: "doji", l: "Doji" },
              { v: "hammer", l: "Hammer" },
              { v: "inverted_hammer", l: "Inverted Hammer" },
              { v: "gravestone", l: "Gravestone Doji" },
              { v: "bullish_engulfing", l: "Bullish Engulfing" },
              { v: "bearish_engulfing", l: "Bearish Engulfing" },
            ].map((p) => <SelectItem key={p.v} value={p.v}>{p.l}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {ind.kind === "number" && (
        <NumberInput
          value={ind.value}
          onChange={(n) => updateInd({ kind: "number", value: n })}
        />
      )}
      {/* trailing days-ago removed; moved to front */}
    </div>
  );
}

function ExprEditor({ value, onChange, depth = 0, hideWrap = false, onComparisonPick }: { value: Expr; onChange: (e: Expr) => void; depth?: number; hideWrap?: boolean; onComparisonPick?: (op: Operator | "") => void }) {
  const wrapBinop = (op: "+" | "-" | "*" | "/") => {
    onChange({ type: "binop", op, a: value, b: newLeafExpr({ kind: "number", value: 20 }) });
  };
  const unwrap = (side: "a" | "b") => {
    if (value.type === "binop") onChange(side === "a" ? value.a : value.b);
  };

  if (value.type === "leaf") {
    const sigmaButton = depth < 2 && !hideWrap ? (
      <OperatorPicker
        value=""
        onChange={(op) => {
          if (!op) return;
          if (COMPARISON_OPS.some((c) => c.value === op)) {
            if (onComparisonPick) onComparisonPick(op as Operator);
          } else {
            wrapBinop(op as ArithOp);
          }
        }}
        actionable={["arithmetic", "comparison"]}
        allowNone={false}
        triggerStyle="symbol"
        title="Select operation"
        triggerClassName="h-6 px-1 bg-input border-input hover:bg-input/80"
      />
    ) : null;

    // Bracket: render inline as siblings so inner content participates in
    // the parent flex-wrap — no enclosing bg box around the inner ExprEditor
    if (value.ind.kind === "bracket") {
      return (
        <Fragment>
          <div className="flex items-center gap-0.5 bg-secondary/40 rounded-md px-1 py-0">
            <IndicatorPicker value="bracket" onChange={(k) => onChange({ ...value, ind: defaultLeaf(k) })} />
          </div>
          <span className="text-xs text-muted-foreground font-mono">(</span>
          <ExprEditor
            value={value.ind.expr}
            onChange={(e) => onChange({ ...value, ind: { kind: "bracket", expr: e } })}
            depth={depth}
            onComparisonPick={onComparisonPick}
          />
          <span className="text-xs text-muted-foreground font-mono">)</span>
          {sigmaButton}
        </Fragment>
      );
    }

    return (
      <Fragment>
        <LeafEditor value={value} onChange={onChange} />
        {sigmaButton}
      </Fragment>
    );
  }
  // binop — Fragment so items flow inline into the parent flex-wrap (no wrapping boundary)
  return (
    <Fragment>
      <ExprEditor value={value.a} onChange={(a) => onChange({ ...value, a })} depth={depth + 1} hideWrap onComparisonPick={onComparisonPick} />
      <OperatorPicker
        value={value.op}
        onChange={(op) => {
          if (!op) {
            onChange(value.a);
          } else if (COMPARISON_OPS.some((c) => c.value === op)) {
            if (onComparisonPick) onComparisonPick(op as Operator);
          } else {
            onChange({ ...value, op: op as ArithOp });
          }
        }}
        actionable={["arithmetic", "comparison"]}
        allowNone
        triggerStyle="auto"
        title="Select operation"
        triggerClassName="h-6 px-1 bg-input border-input hover:bg-input/80"
      />
      <ExprEditor value={value.b} onChange={(b) => onChange({ ...value, b })} depth={depth} hideWrap={hideWrap} onComparisonPick={onComparisonPick} />
    </Fragment>
  );
}

export function ConditionRow({ condition, onChange, onRemove, onDuplicate, onCopy, onToggle, isDragging, isDragOver, dragPush, onDragStart, onDragOver, onDrop, onDragEnd }: Props) {
  const enabled = condition.enabled !== false;
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex items-start gap-1 rounded-lg border px-2 py-0.5 transition-all duration-150
        ${enabled ? "border-border bg-card/50" : "border-border/40 bg-card/20 opacity-50"}
        ${isDragging ? "opacity-30 scale-[0.98] shadow-none" : ""}
        ${isDragOver ? "border-primary/70 bg-primary/5 shadow-[0_0_0_2px_hsl(var(--primary)/0.5)]" : ""}
        ${dragPush === "up" ? "-translate-y-2" : ""}
        ${dragPush === "down" ? "translate-y-2" : ""}
      `}
    >
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="shrink-0 flex items-center self-stretch px-1.5 -mx-1 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/30 rounded transition-colors select-none"
        title="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <span className="shrink-0 text-xs text-muted-foreground font-medium pt-1">IF</span>
      <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">
        <ExprEditor
          value={condition.left}
          onChange={(e) => onChange({ ...condition, left: e })}
          hideWrap
          onComparisonPick={(op) => {
            if (!op) {
              onChange({ ...condition, op: "" });
              return;
            }
            if (condition.op === "" && condition.left.type === "binop") {
              onChange({ ...condition, op: op as Operator, left: condition.left.a, right: condition.left.b });
            } else {
              onChange({ ...condition, op: op as Operator });
            }
          }}
        />
        <ConditionOperatorPicker condition={condition} onChange={onChange} />
        {condition.op !== "" && (
          <ExprEditor
            value={condition.right}
            onChange={(e) => onChange({ ...condition, right: e })}
            onComparisonPick={(op) => onChange({ ...condition, op: op as Operator | "" })}
          />
        )}
        <div className="flex items-center gap-1 ml-4">
          <button
            type="button"
            onClick={() => onChange({ ...condition, logicOp: condition.logicOp === "or" ? "and" : "or" })}
            title={condition.logicOp === "or" ? "OR logic — click to switch to AND" : "AND logic — click to switch to OR"}
            className={`h-4 px-1 rounded border text-[8px] font-bold leading-none transition-colors flex items-center justify-center ${
              condition.logicOp === "or"
                ? "border-orange-400/60 text-orange-400 bg-orange-400/10 hover:bg-orange-400/20"
                : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {condition.logicOp === "or" ? "OR" : "AND"}
          </button>
          {onCopy && (
            <Button variant="ghost" size="icon" className="h-5 w-5 text-success hover:text-success hover:bg-success/10" onClick={onCopy} title="Copy filter">
              <Copy className="h-2.5 w-2.5" />
            </Button>
          )}
          {onDuplicate && (
            <Button variant="ghost" size="icon" className="h-5 w-5 text-primary hover:text-primary hover:bg-primary/10" onClick={onDuplicate} title="Duplicate filter">
              <CopyPlus className="h-2.5 w-2.5" />
            </Button>
          )}
          {onToggle && (
            <Button
              variant="ghost"
              size="icon"
              className={`h-5 w-5 transition-colors ${enabled ? "hover:bg-success/10" : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/50"}`}
              style={enabled ? { color: '#39ff14' } : undefined}
              onClick={onToggle}
              title={enabled ? "Disable filter" : "Enable filter"}
            >
              <Power className="h-3 w-3" strokeWidth={3} />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onRemove} title="Remove">
            <X className="h-2.5 w-2.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function newCondition(): Condition {
  return {
    id: Math.random().toString(36).slice(2),
    left: newLeafExpr({ kind: "close" }),
    op: "",
    right: newLeafExpr({ kind: "number", value: 20 }),
    enabled: true,
  };
}
