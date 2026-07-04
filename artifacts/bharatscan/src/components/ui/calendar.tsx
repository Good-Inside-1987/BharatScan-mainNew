import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { DayPicker, useDayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  /** Optional function — return true for dates that should appear red (weekends / NSE holidays). */
  marketOffMatcher?: (date: Date) => boolean;
};

/** Custom caption: [<] [Month ▾] [Year ▾] [>] all on one centered row. */
function CompactCaption() {
  const { goToMonth, months, nextMonth, previousMonth } = useDayPicker();
  const current = months[0]?.date ?? new Date();
  const monthIdx = current.getMonth();
  const year = current.getFullYear();
  const startYear = 2000;
  const endYear = new Date().getFullYear() + 1;
  const years: number[] = [];
  for (let y = endYear; y >= startYear; y--) years.push(y);
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const selectClass =
    "appearance-none bg-transparent text-foreground text-xs font-semibold pr-4 pl-1 py-0.5 rounded hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-accent/40 cursor-pointer";
  return (
    <div className="flex items-center justify-center gap-1.5 h-7">
      <button
        type="button"
        aria-label="Previous month"
        disabled={!previousMonth}
        onClick={() => previousMonth && goToMonth(previousMonth)}
        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted/40 disabled:opacity-40 disabled:pointer-events-none text-foreground"
      >
        <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
      </button>
      <div className="relative inline-flex items-center">
        <select
          value={monthIdx}
          onChange={(e) => {
            const m = Number(e.target.value);
            goToMonth(new Date(year, m, 1));
          }}
          className={selectClass}
          aria-label="Select month"
        >
          {monthNames.map((name, i) => (
            <option key={name} value={i}>{name}</option>
          ))}
        </select>
        <ChevronDown className="h-3 w-3 absolute right-0.5 pointer-events-none text-muted-foreground" />
      </div>
      <div className="relative inline-flex items-center">
        <select
          value={year}
          onChange={(e) => {
            const y = Number(e.target.value);
            goToMonth(new Date(y, monthIdx, 1));
          }}
          className={selectClass}
          aria-label="Select year"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <ChevronDown className="h-3 w-3 absolute right-0.5 pointer-events-none text-muted-foreground" />
      </div>
      <button
        type="button"
        aria-label="Next month"
        disabled={!nextMonth}
        onClick={() => nextMonth && goToMonth(nextMonth)}
        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted/40 disabled:opacity-40 disabled:pointer-events-none text-foreground"
      >
        <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  marketOffMatcher,
  modifiers: externalModifiers,
  modifiersClassNames: externalModifiersClassNames,
  components: externalComponents,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-2", className)}
      classNames={{
        months: "flex flex-col gap-2",
        month: "space-y-1.5",
        month_caption: "flex items-center justify-center",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "text-muted-foreground rounded w-7 font-normal text-[0.65rem] text-center",
        week: "flex w-full mt-0.5",
        day: "h-7 w-7 text-center text-xs p-0 relative focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 p-0 font-normal text-xs aria-selected:opacity-100",
        ),
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary [&>button:hover]:text-primary-foreground [&>button:focus]:bg-primary [&>button:focus]:text-primary-foreground",
        today: "[&>button]:bg-accent [&>button]:text-accent-foreground",
        outside:
          "day-outside [&>button]:text-muted-foreground [&>button]:opacity-50",
        disabled:
          "[&>button]:text-muted-foreground [&>button]:opacity-40 [&>button]:pointer-events-none",
        hidden: "invisible",
        nav: "hidden",
        ...classNames,
      }}
      modifiers={{
        ...(marketOffMatcher ? { marketOff: marketOffMatcher } : {}),
        ...externalModifiers,
      }}
      modifiersClassNames={{
        ...(marketOffMatcher ? { marketOff: "rdp-market-off" } : {}),
        ...externalModifiersClassNames,
      }}
      components={{
        MonthCaption: CompactCaption,
        ...externalComponents,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
