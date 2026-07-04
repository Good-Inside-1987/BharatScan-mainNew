import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LogicMode } from "@/lib/screener";

const LOGIC_OPTIONS: { value: LogicMode; label: string }[] = [
  { value: "all",  label: "all" },
  { value: "any1", label: "any 1" },
  { value: "any2", label: "any 2" },
  { value: "any3", label: "any 3" },
  { value: "any4", label: "any 4" },
  { value: "any5", label: "any 5" },
];

export function LogicModeSelect({
  value,
  onChange,
}: {
  value: LogicMode;
  onChange: (v: LogicMode) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as LogicMode)}>
      <SelectTrigger className="h-5 px-1.5 py-0 text-xs font-semibold bg-primary/20 border-primary/40 text-primary w-auto gap-1 focus:ring-0 rounded">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LOGIC_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
