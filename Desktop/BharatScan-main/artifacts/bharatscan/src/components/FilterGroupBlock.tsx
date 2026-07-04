import { Plus, Trash2, GripVertical, ClipboardPaste, Layers, Power, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConditionRow, newCondition, NameModeContext } from "@/components/ConditionRow";
import { LogicModeSelect } from "@/components/LogicModeSelect";
import type { ConditionGroup, Condition, FilterItem } from "@/lib/screener";
import { isGroup, newGroup } from "@/lib/screener";
import { useContext, useState, useEffect, memo } from "react";

export type DragSrc =
  | { kind: "top"; idx: number }
  | { kind: "inner"; topIdx: number; condIdx: number };

interface FilterGroupBlockProps {
  group: ConditionGroup;
  onChange: (updated: ConditionGroup) => void;
  onDelete: () => void;
  onToggle?: () => void;
  conditionClipboard: Condition | null;
  onCopyCondition: (c: Condition) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  isDragging?: boolean;
  isDragOver?: boolean;
  topIdx: number;
  activeDrag: DragSrc | null;
  activeDragIsGroup: boolean;
  onDropOnGroup: (src: DragSrc) => void;
  onInnerDragStart: (condIdx: number) => void;
  onInnerDragEnd: () => void;
  depth?: number;
}

function FilterGroupBlockBase({
  group,
  onChange,
  onDelete,
  onToggle,
  conditionClipboard,
  onCopyCondition,
  dragHandleProps,
  isDragging,
  isDragOver,
  topIdx,
  activeDrag,
  activeDragIsGroup,
  onDropOnGroup,
  onInnerDragStart,
  onInnerDragEnd,
  depth = 0,
}: FilterGroupBlockProps) {
  const nameMode = useContext(NameModeContext);

  // Collapse / expand
  const [collapsed, setCollapsed] = useState(false);

  // Within-group condition reorder
  const [innerDragIdx, setInnerDragIdx] = useState<number | null>(null);
  const [innerDragOver, setInnerDragOver] = useState<number | null>(null);

  // Top-level body hover (for external drops)
  const [groupBodyOver, setGroupBodyOver] = useState(false);

  // Nested sub-group reorder
  const [nestedDragIdx, setNestedDragIdx] = useState<number | null>(null);
  const [nestedDragOver, setNestedDragOver] = useState<number | null>(null);

  // Cross-nested-group: condition dragged FROM a sibling nested group
  const [nestedCondDrag, setNestedCondDrag] = useState<{ nestedGroupIdx: number; condIdx: number } | null>(null);
  const [nestedCondDragOver, setNestedCondDragOver] = useState<number | null>(null);

  // Sibling ConditionRow hovering over a nested sub-group (drop INTO it)
  const [condOverNestedIdx, setCondOverNestedIdx] = useState<number | null>(null);

  // Condition from a nested sub-group hovering over a parent-level ConditionRow (lift out)
  const [nestedCondAtParentIdx, setNestedCondAtParentIdx] = useState<number | null>(null);

  const isDisabled = group.enabled === false;

  useEffect(() => {
    if (innerDragIdx !== null) {
      setInnerDragIdx(null);
      setInnerDragOver(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.conditions.length]);

  function addCondition() {
    onChange({ ...group, conditions: [...group.conditions, newCondition()] });
  }

  function addSubGroup() {
    onChange({ ...group, conditions: [...group.conditions, newGroup()] });
  }

  function pasteCondition() {
    if (!conditionClipboard) return;
    onChange({ ...group, conditions: [...group.conditions, { ...conditionClipboard, id: crypto.randomUUID() }] });
  }

  function updateItem(id: string, updated: FilterItem) {
    onChange({ ...group, conditions: group.conditions.map((c) => (c.id === id ? updated : c)) });
  }

  function deleteItem(id: string) {
    onChange({ ...group, conditions: group.conditions.filter((c) => c.id !== id) });
  }

  function duplicateCondition(idx: number) {
    const item = group.conditions[idx];
    const clone = { ...item, id: crypto.randomUUID() } as FilterItem;
    const next = [...group.conditions];
    next.splice(idx + 1, 0, clone);
    onChange({ ...group, conditions: next });
  }

  function toggleNestedGroup(id: string) {
    onChange({
      ...group,
      conditions: group.conditions.map((c) =>
        c.id === id && isGroup(c) ? { ...c, enabled: c.enabled !== false ? false : true } : c
      ),
    });
  }

  function moveConditionBetweenNestedGroups(srcNestedIdx: number, srcCondIdx: number, tgtNestedIdx: number) {
    const next = [...group.conditions];
    const srcNested = next[srcNestedIdx] as ConditionGroup;
    const srcConds = [...srcNested.conditions];
    const [movedCond] = srcConds.splice(srcCondIdx, 1);
    next[srcNestedIdx] = { ...srcNested, conditions: srcConds };
    const tgtNested = next[tgtNestedIdx] as ConditionGroup;
    next[tgtNestedIdx] = { ...tgtNested, conditions: [...tgtNested.conditions, movedCond] };
    onChange({ ...group, conditions: next });
  }

  function liftConditionFromNested(srcNestedIdx: number, srcCondIdx: number, insertAtIdx: number) {
    const next = [...group.conditions];
    const srcNested = next[srcNestedIdx] as ConditionGroup;
    const srcConds = [...srcNested.conditions];
    const [movedCond] = srcConds.splice(srcCondIdx, 1);
    next[srcNestedIdx] = { ...srcNested, conditions: srcConds };
    if (insertAtIdx < 0) {
      next.push(movedCond as FilterItem);
    } else {
      next.splice(insertAtIdx, 0, movedCond as FilterItem);
    }
    onChange({ ...group, conditions: next });
  }

  const showDropZone = activeDrag !== null && !(activeDrag.kind === "inner" && activeDrag.topIdx === topIdx);
  const showConditionHint = showDropZone && !activeDragIsGroup;
  const bodyIsDropTarget = showDropZone || nestedCondDrag !== null;
  const receiving = bodyIsDropTarget && groupBodyOver;

  return (
    <div
      className={`rounded-md border bg-white/[0.03] p-2 mb-1 transition-all duration-150 ${
        isDragging ? "opacity-30 scale-[0.98]" : ""
      } ${isDisabled ? "opacity-40" : ""} ${
        receiving
          ? "border-primary/50 bg-primary/5 ring-1 ring-primary/25"
          : isDragOver
          ? "border-primary/60 bg-primary/5"
          : "border-white/10"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (bodyIsDropTarget) setGroupBodyOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) {
          setGroupBodyOver(false);
          setNestedCondAtParentIdx(null);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setGroupBodyOver(false);

        if (nestedCondDrag !== null) {
          liftConditionFromNested(nestedCondDrag.nestedGroupIdx, nestedCondDrag.condIdx, -1);
          setNestedCondDrag(null);
          setNestedCondDragOver(null);
          setNestedCondAtParentIdx(null);
          return;
        }

        const raw = e.dataTransfer.getData("text/plain");
        if (!raw) return;
        try {
          const src = JSON.parse(raw) as DragSrc;
          if (src.kind === "inner" && src.topIdx === topIdx) return;
          if (src.kind === "top" && src.idx === undefined) return;
          onDropOnGroup(src);
        } catch {}
      }}
    >
      {/* ── Header row ── */}
      <div className="flex items-center gap-1.5 mb-1.5 text-xs text-muted-foreground/80 select-none">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="shrink-0 flex items-center justify-center h-4 w-4 rounded text-muted-foreground hover:text-white hover:bg-white/15 transition-colors"
          title={collapsed ? "Expand group" : "Collapse group"}
        >
          {collapsed ? <ChevronRight size={13} strokeWidth={3} /> : <ChevronDown size={13} strokeWidth={3} />}
        </button>
        <div
          {...dragHandleProps}
          className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground shrink-0"
          title="Drag to reorder group"
        >
          <GripVertical size={14} />
        </div>
        <span className="shrink-0">Stock passes</span>
        <LogicModeSelect
          value={group.logicMode}
          onChange={(v) => onChange({ ...group, logicMode: v })}
        />
        <span className="shrink-0">of the below filters</span>
        {collapsed && group.conditions.length > 0 && (
          <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/15 text-primary/90 leading-none select-none">
            {group.conditions.length} {group.conditions.length === 1 ? "filter" : "filters"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          {onToggle && (
            <Button
              variant="ghost"
              size="icon"
              className={`h-5 w-5 transition-colors ${
                isDisabled
                  ? "text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/50"
                  : "hover:bg-success/10"
              }`}
              style={isDisabled ? undefined : { color: "#39ff14" }}
              onClick={onToggle}
              title={isDisabled ? "Enable this group" : "Disable this group"}
            >
              <Power className="h-3 w-3" strokeWidth={3} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-destructive-bright shrink-0"
            onClick={onDelete}
            title="Delete this group"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {/* ── Body (hidden when collapsed) ── */}
      {!collapsed && (
        <>
          {/* Items */}
          <div className="pl-3 border-l border-white/10 space-y-1">
            {group.conditions.length === 0 && (showConditionHint || nestedCondDrag !== null) && (
              <div
                className={`h-8 rounded border border-dashed transition-all duration-150 flex items-center justify-center text-[10px] ${
                  receiving ? "border-primary/60 bg-primary/5 text-primary" : "border-white/20 text-muted-foreground/40"
                }`}
              >
                {receiving ? "↓ Release to add to group" : "Drop a filter here to add to group"}
              </div>
            )}

            {group.conditions.map((item, idx) => {
              /* ── Nested sub-group ── */
              if (isGroup(item)) {
                const isNestedDragging = nestedDragIdx === idx;
                const isNestedOver = nestedDragOver === idx && nestedDragIdx !== idx;
                const isCondDropTarget = nestedCondDrag !== null && nestedCondDrag.nestedGroupIdx !== idx;
                const isCondDropOver = isCondDropTarget && nestedCondDragOver === idx;
                const isSiblingCondDrag =
                  innerDragIdx !== null &&
                  innerDragIdx < group.conditions.length &&
                  !isGroup(group.conditions[innerDragIdx]);
                const isSiblingCondOver = isSiblingCondDrag && condOverNestedIdx === idx;

                return (
                  <div
                    key={item.id}
                    className={`rounded-md transition-all duration-150 ${isNestedDragging ? "opacity-30 scale-[0.98]" : ""} ${
                      isCondDropOver || isSiblingCondOver
                        ? "ring-2 ring-cyan-400/60 bg-cyan-400/5"
                        : isNestedOver
                        ? "ring-1 ring-primary/50"
                        : isCondDropTarget || isSiblingCondDrag
                        ? "ring-1 ring-cyan-400/25"
                        : ""
                    }`}
                    onDragOver={(e) => {
                      if (nestedDragIdx !== null) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        if (nestedDragOver !== idx) setNestedDragOver(idx);
                        return;
                      }
                      if (isSiblingCondDrag) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        if (condOverNestedIdx !== idx) setCondOverNestedIdx(idx);
                        return;
                      }
                      if (isCondDropTarget) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        if (nestedCondDragOver !== idx) setNestedCondDragOver(idx);
                      }
                    }}
                    onDragLeave={(e) => {
                      if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) {
                        if (nestedCondDragOver === idx) setNestedCondDragOver(null);
                        if (nestedDragOver === idx) setNestedDragOver(null);
                        if (condOverNestedIdx === idx) setCondOverNestedIdx(null);
                      }
                    }}
                    onDrop={(e) => {
                      const raw = e.dataTransfer.getData("text/plain");
                      try {
                        const src = JSON.parse(raw);

                        // Sub-group reorder
                        if (
                          src.kind === "nested-group" &&
                          src.parentGroupId === group.id &&
                          nestedDragIdx !== null &&
                          nestedDragIdx !== idx
                        ) {
                          e.preventDefault();
                          e.stopPropagation();
                          const next = [...group.conditions];
                          const [moved] = next.splice(nestedDragIdx, 1);
                          next.splice(idx, 0, moved);
                          onChange({ ...group, conditions: next });
                          setNestedDragIdx(null);
                          setNestedDragOver(null);
                          return;
                        }

                        // Sibling ConditionRow dropped INTO this sub-group
                        if (
                          innerDragIdx !== null &&
                          innerDragIdx < group.conditions.length &&
                          !isGroup(group.conditions[innerDragIdx])
                        ) {
                          e.preventDefault();
                          e.stopPropagation();
                          const next = [...group.conditions];
                          const [movedCond] = next.splice(innerDragIdx, 1);
                          const adjustedIdx = innerDragIdx < idx ? idx - 1 : idx;
                          const tgtNested = next[adjustedIdx] as ConditionGroup;
                          next[adjustedIdx] = {
                            ...tgtNested,
                            conditions: [...tgtNested.conditions, movedCond as Condition],
                          };
                          onChange({ ...group, conditions: next });
                          setInnerDragIdx(null);
                          setInnerDragOver(null);
                          setCondOverNestedIdx(null);
                          return;
                        }

                        // Cross-nested-group condition drop
                        if (nestedCondDrag !== null && nestedCondDrag.nestedGroupIdx !== idx) {
                          e.preventDefault();
                          e.stopPropagation();
                          moveConditionBetweenNestedGroups(nestedCondDrag.nestedGroupIdx, nestedCondDrag.condIdx, idx);
                          setNestedCondDrag(null);
                          setNestedCondDragOver(null);
                        }
                      } catch {}
                    }}
                  >
                    {(isCondDropOver || isSiblingCondOver) && (
                      <div className="text-[10px] text-cyan-400 text-center py-0.5 mb-0.5 select-none pointer-events-none">
                        ↓ Drop to move condition into this group
                      </div>
                    )}
                    <FilterGroupBlock
                      group={item}
                      onChange={(updated) => updateItem(item.id, updated)}
                      onDelete={() => deleteItem(item.id)}
                      onToggle={() => toggleNestedGroup(item.id)}
                      conditionClipboard={conditionClipboard}
                      onCopyCondition={onCopyCondition}
                      dragHandleProps={
                        {
                          draggable: true,
                          onDragStart: (e: React.DragEvent) => {
                            e.stopPropagation();
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData(
                              "text/plain",
                              JSON.stringify({ kind: "nested-group", parentGroupId: group.id, idx })
                            );
                            requestAnimationFrame(() => {
                              setNestedDragIdx(idx);
                              setNestedDragOver(null);
                            });
                          },
                          onDragEnd: (e: React.DragEvent) => {
                            e.stopPropagation();
                            setNestedDragIdx(null);
                            setNestedDragOver(null);
                          },
                        } as React.HTMLAttributes<HTMLDivElement>
                      }
                      isDragging={isNestedDragging}
                      isDragOver={isNestedOver}
                      topIdx={topIdx}
                      activeDrag={null}
                      activeDragIsGroup={false}
                      onDropOnGroup={() => {}}
                      onInnerDragStart={(condIdx) => {
                        setNestedCondDrag({ nestedGroupIdx: idx, condIdx });
                        setNestedCondDragOver(null);
                        setNestedCondAtParentIdx(null);
                      }}
                      onInnerDragEnd={() => {
                        setNestedCondDrag(null);
                        setNestedCondDragOver(null);
                        setNestedCondAtParentIdx(null);
                      }}
                      depth={depth + 1}
                    />
                  </div>
                );
              }

              /* ── Plain ConditionRow ── */
              const isNestedCondHoveringHere = nestedCondDrag !== null && nestedCondAtParentIdx === idx;
              return (
                <ConditionRow
                  key={item.id}
                  condition={item}
                  onChange={(updated) => updateItem(item.id, updated)}
                  onRemove={() => deleteItem(item.id)}
                  onCopy={() => onCopyCondition({ ...item })}
                  onDuplicate={() => duplicateCondition(idx)}
                  onToggle={() =>
                    updateItem(item.id, { ...item, enabled: item.enabled === false ? true : false })
                  }
                  isDragging={innerDragIdx === idx}
                  isDragOver={
                    (innerDragOver === idx && innerDragIdx !== idx) || isNestedCondHoveringHere
                  }
                  dragPush={
                    innerDragIdx !== null && innerDragIdx !== idx && innerDragOver !== null
                      ? innerDragIdx < idx && idx <= innerDragOver
                        ? "up"
                        : innerDragIdx > idx && idx >= innerDragOver
                        ? "down"
                        : undefined
                      : undefined
                  }
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData(
                      "text/plain",
                      JSON.stringify({ kind: "inner", topIdx, condIdx: idx })
                    );
                    requestAnimationFrame(() => {
                      setInnerDragIdx(idx);
                      onInnerDragStart(idx);
                    });
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (innerDragIdx !== null && innerDragOver !== idx) setInnerDragOver(idx);
                    if (nestedCondDrag !== null && nestedCondAtParentIdx !== idx)
                      setNestedCondAtParentIdx(idx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();

                    // Lift: condition from nested sub-group → this parent slot
                    if (nestedCondDrag !== null) {
                      e.stopPropagation();
                      liftConditionFromNested(nestedCondDrag.nestedGroupIdx, nestedCondDrag.condIdx, idx);
                      setNestedCondDrag(null);
                      setNestedCondDragOver(null);
                      setNestedCondAtParentIdx(null);
                      return;
                    }

                    // Normal within-group reorder
                    const raw = e.dataTransfer.getData("text/plain");
                    let src: DragSrc | null = null;
                    try { src = JSON.parse(raw); } catch {}
                    if (
                      src?.kind === "inner" &&
                      src.topIdx === topIdx &&
                      innerDragIdx !== null &&
                      innerDragIdx !== idx
                    ) {
                      e.stopPropagation();
                      const next = [...group.conditions];
                      const [moved] = next.splice(innerDragIdx, 1);
                      next.splice(idx, 0, moved);
                      onChange({ ...group, conditions: next });
                      setInnerDragIdx(null);
                      setInnerDragOver(null);
                    }
                  }}
                  onDragEnd={() => {
                    setInnerDragIdx(null);
                    setInnerDragOver(null);
                    onInnerDragEnd();
                  }}
                />
              );
            })}
          </div>

          {/* Drop-here hint at bottom for external / lift-out drags */}
          {(showConditionHint || nestedCondDrag !== null) && group.conditions.length > 0 && (
            <div
              className={`mt-1.5 rounded border border-dashed transition-all duration-150 h-6 flex items-center justify-center text-[10px] ${
                receiving
                  ? "border-primary/60 bg-primary/5 text-primary"
                  : nestedCondDrag !== null
                  ? "border-cyan-400/30 text-cyan-400/60"
                  : "border-white/15 text-muted-foreground/35"
              }`}
            >
              {receiving
                ? "↓ Release to add to group"
                : nestedCondDrag !== null
                ? "↓ Drop here to move out of sub-group"
                : "Drag a filter here to add to group"}
            </div>
          )}

          {/* Footer: Add / Paste */}
          <div
            className={`flex items-center gap-1.5 mt-1.5${
              group.conditions.length > 0 ? " pt-1.5 border-t border-white/10" : ""
            } pl-3`}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1 text-primary">
                  <Plus size={12} />
                  Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="text-xs">
                <DropdownMenuItem onClick={addCondition}>
                  <Plus size={13} className="mr-2" /> Add Condition
                </DropdownMenuItem>
                <DropdownMenuItem onClick={addSubGroup}>
                  <Layers size={13} className="mr-2" /> Add Sub-Filter Group
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1 text-muted-foreground"
              onClick={pasteCondition}
              disabled={!conditionClipboard}
              title={conditionClipboard ? "Paste condition" : "No condition copied"}
            >
              <ClipboardPaste size={12} />
              Paste Filter
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// Only re-render when condition data or direct visual state changes.
// Skips re-renders caused solely by handler reference churn (new arrow
// functions every parent render), which fires on every drag-state update.
export const FilterGroupBlock = memo(FilterGroupBlockBase, (prev, next) =>
  prev.group === next.group &&
  prev.isDragging === next.isDragging &&
  prev.isDragOver === next.isDragOver &&
  prev.conditionClipboard === next.conditionClipboard &&
  prev.activeDrag === next.activeDrag &&
  prev.activeDragIsGroup === next.activeDragIsGroup &&
  prev.topIdx === next.topIdx
);
