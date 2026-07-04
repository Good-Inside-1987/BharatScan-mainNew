interface Props {
  data: { date: string; matches: number }[];
  /** Date string of the currently selected pillar (highlighted). */
  selectedDate?: string | null;
  /** Fired when a pillar is clicked. Receives the date and its index in `data`. */
  onSelect?: (date: string, idx: number) => void;
}

// Bar chart of per-day match counts. Each pillar is a button — clicking one
// highlights it (primary tint + ring) and notifies the parent so it can
// recompute "Backtest Results" for that specific day. Even zero-match days
// remain clickable because the entire column is the click target, not just
// the bar above the baseline.
export function BacktestChart({ data, selectedDate, onSelect }: Props) {
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => d.matches));
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="flex items-end gap-[2px] h-40">
        {data.map((d, i) => {
          const isSelected = d.date === selectedDate;
          const heightPct = (d.matches / max) * 100;
          return (
            <button
              type="button"
              key={d.date}
              onClick={() => onSelect?.(d.date, i)}
              title={`${d.date}: ${d.matches} match${d.matches === 1 ? "" : "es"}`}
              className={`group relative flex-1 h-full flex flex-col items-center justify-end rounded-t-sm transition-colors cursor-pointer ${
                isSelected
                  ? "bg-primary/20 ring-1 ring-primary"
                  : "hover:bg-secondary/40"
              }`}
            >
              <div
                className={`w-full rounded-t-sm transition-opacity ${
                  isSelected
                    ? "bg-primary"
                    : "bg-foreground/70 group-hover:bg-foreground/90"
                }`}
                style={{
                  height: `${heightPct}%`,
                  minHeight: d.matches > 0 ? "2px" : "0",
                }}
              />
              <div className="absolute -top-8 hidden group-hover:block bg-popover border border-border text-popover-foreground text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-10 pointer-events-none">
                {d.date}: <span className="font-semibold">{d.matches}</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
        <span>{data[0].date}</span>
        <span className="font-medium">Max: {max}</span>
        <span>{data[data.length - 1].date}</span>
      </div>
    </div>
  );
}
