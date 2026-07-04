import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useData } from "@/context/DataContext";
import logoUrl from "@/assets/bharatscan-logo.png";
import { LAST_UPDATE, APP_VERSION } from "@/lib/lastUpdate";

export function GlobalHeader() {
  const {
    quotes, holidays,
    dateMode, setDateMode,
    historicalDate, setHistoricalDate,
    now, marketTarget, targetHoliday,
    realNow,
  } = useData();
  const { theme } = useTheme();

  const [quoteIdx, setQuoteIdx] = useState<number>(() => Math.floor(Math.random() * Math.max(1, quotes.length)));
  const [quoteFade, setQuoteFade] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (!quotes.length) return;
    const pickRandom = (current: number) => {
      if (quotes.length === 1) return 0;
      let next: number;
      do { next = Math.floor(Math.random() * quotes.length); } while (next === current);
      return next;
    };
    const id = setInterval(() => {
      setQuoteFade(false);
      setTimeout(() => { setQuoteIdx((i) => pickRandom(i)); setQuoteFade(true); }, 400);
    }, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [quotes.length]);

  const activeQuote = quotes.length ? quotes[quoteIdx] : null;

  const csvOpen = targetHoliday ? /^open$/i.test(targetHoliday.status.trim()) : null;
  const closed = csvOpen === null ? marketTarget.isWeekend : !csvOpen;
  const statusLabel = closed ? "CLOSE" : "OPEN";
  const occasion = targetHoliday?.occasion
    || (marketTarget.isWeekend ? (marketTarget.date.getDay() === 0 ? "Sunday" : "Saturday") : "");

  return (
    <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
      <div className="container relative flex items-center py-1.5 gap-4">
        {/* Left — logo + brand + market status */}
        <div className="flex-shrink-0">
          <div className="flex items-center gap-1">
            <img
              src={logoUrl}
              alt="BharatScan logo"
              className={`h-9 w-9 object-contain transition-[filter] duration-300 ${
                theme === "light"
                  ? "[filter:invert(1)_drop-shadow(0_0_4px_rgba(96,165,250,0.3))_drop-shadow(0_0_8px_rgba(34,197,94,0.15))]"
                  : "[filter:drop-shadow(0_0_4px_rgba(96,165,250,0.2))_drop-shadow(0_0_8px_rgba(34,197,94,0.1))]"
              }`}
            />
            <div>
              <h1 className="text-base font-bold tracking-tight leading-tight">BharatScan</h1>
              <p className="text-[9px] text-muted-foreground leading-tight">Scan Smart. Filter Better. Invest Wisely.</p>
            </div>
          </div>
          {/* Market Status */}
          <div className="mt-1 ml-10">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold whitespace-nowrap">
                Market Is
              </span>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap ${
                closed
                  ? "bg-destructive-bright/10 text-destructive-bright border border-destructive-bright/40"
                  : "bg-success/10 text-success border border-success/40"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${closed ? "bg-destructive-bright" : "bg-success"}`} />
                {statusLabel}
              </span>
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold whitespace-nowrap">
                {marketTarget.label}
              </span>
            </div>
            {occasion && (
              <p className="text-[9px] text-muted-foreground mt-0.5" title={occasion}>
                {occasion}
              </p>
            )}
          </div>
        </div>

        {/* Centre — rotating investment quote */}
        {activeQuote && (
          <div
            className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center justify-center text-center pointer-events-none max-w-xl px-4"
            style={{ opacity: quoteFade ? 1 : 0, transition: "opacity 0.4s ease" }}
          >
            <p className="text-sm font-bold italic text-foreground/90 leading-snug line-clamp-2">
              <span className="text-primary font-bold text-base not-italic mr-1 leading-none align-bottom">"</span>
              {activeQuote.text}
              <span className="text-primary font-bold text-base not-italic ml-0.5 leading-none align-bottom">"</span>
            </p>
            <p className="text-[11px] text-foreground/70 font-medium mt-1 tracking-wide">
              — {activeQuote.author}
            </p>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right — date mode toggle + calendar picker + date label */}
        <div className="flex items-center gap-3 text-sm flex-shrink-0">
          <div className="flex flex-col items-center gap-0.5">
            {/* Date-mode pill */}
            <div className="inline-flex items-center rounded border border-border bg-input p-px h-5" title="Switch between today's date and a historical 'as of' date">
              <button
                type="button"
                onClick={() => setDateMode("today")}
                className={`flex items-center justify-center px-1.5 h-full text-[8px] font-bold tracking-wide rounded-sm transition-colors leading-none ${
                  dateMode === "today"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Live
              </button>
              <button
                type="button"
                onClick={() => setDateMode("historical")}
                className={`flex items-center justify-center px-1.5 h-full text-[8px] font-bold tracking-wide rounded-sm transition-colors leading-none ${
                  dateMode === "historical"
                    ? "bg-orange-500 text-white"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Past
              </button>
            </div>
            {/* Calendar picker — only in historical mode */}
            {dateMode === "historical" && (
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-5 inline-flex items-center gap-1 rounded border border-border bg-input px-1.5 text-[8px] text-foreground hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer"
                    aria-label="Pick a historical date"
                  >
                    <CalendarIcon className="h-2.5 w-2.5 text-muted-foreground" />
                    {(() => {
                      const [y, m, d] = historicalDate.split("-").map(Number);
                      const dt = new Date(y, (m || 1) - 1, d || 1);
                      return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                    })()}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  {(() => {
                    const [y, m, d] = historicalDate.split("-").map(Number);
                    const selectedDate = new Date(y, (m || 1) - 1, d || 1);
                    const holidayIsoSet = new Set(holidays.map((h) => h.date));
                    return (
                      <Calendar
                        key={historicalDate}
                        mode="single"
                        selected={selectedDate}
                        defaultMonth={selectedDate}
                        onSelect={(picked) => {
                          if (!picked) return;
                          const iso = `${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, "0")}-${String(picked.getDate()).padStart(2, "0")}`;
                          setHistoricalDate(iso);
                          setCalendarOpen(false);
                        }}
                        disabled={(d) => d > realNow}
                        marketOffMatcher={(d) => {
                          const dow = d.getDay();
                          if (dow === 0 || dow === 6) return true;
                          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                          return holidayIsoSet.has(iso);
                        }}
                        initialFocus
                      />
                    );
                  })()}
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Date label + formatted date + last update */}
          <div className="text-right leading-tight">
            <p className={`text-[10px] ${dateMode === "historical" ? "text-orange-500" : "text-muted-foreground"}`}>
              {dateMode === "today" ? "Today's Date" : "Historical Date"}
            </p>
            <p className={`text-sm font-semibold ${dateMode === "today" ? "text-foreground" : "text-orange-500"}`}>
              {now.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
            </p>
            <p className="text-[8px] text-muted-foreground/60 leading-tight mt-0.5">
              Last Update: {LAST_UPDATE}
            </p>
            <p className="text-[8px] text-muted-foreground/60 leading-tight">
              Version: {APP_VERSION}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
