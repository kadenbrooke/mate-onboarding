'use client';
import type { ReactNode } from 'react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { DotsSixVertical, ArrowCounterClockwise, Check } from '@phosphor-icons/react';
import { useStackOrder } from './useStackOrder';
import {
  brandVar, BG_SECTION, BORDER_SOFT, TEXT_DARK, TEXT_MUTED, FONT_BODY,
} from '@/lib/theme';

export interface StackItem {
  id: string;
  node: ReactNode;
}

/**
 * Mobile reorderable stack: drag a card by its handle to reorder, behind the
 * shared Customize (`editing`) mode. Resize is desktop-only, so this is
 * reorder-only. Order persists per session + stack via useStackOrder. When not
 * editing the stack renders as a plain ordered list (no dnd overhead) but still
 * honours the stored order.
 */
export function SortableStack({ sessionId, stackId, items, editing, onDone }: {
  sessionId: string;
  stackId: string;
  items: StackItem[];
  editing: boolean;
  onDone?: () => void;
}) {
  const defaultIds = items.map((i) => i.id);
  const { order, setOrder, reset, isCustomized } = useStackOrder(sessionId, stackId, defaultIds);
  const byId = new Map(items.map((i) => [i.id, i.node]));
  const ordered = order.filter((id) => byId.has(id));

  // Touch needs a short hold so a drag never hijacks a scroll; pointer needs a
  // few px of travel so a tap on the handle still registers as a tap.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setOrder(arrayMove(order, from, to));
  };

  const toolbar = editing ? (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
      padding: '8px 12px', borderRadius: 14, background: BG_SECTION,
      border: `1px solid ${BORDER_SOFT}`,
    }}>
      <span style={{ fontSize: 12, color: TEXT_MUTED, fontFamily: FONT_BODY, flex: 1 }}>
        Drag a card by its handle to reorder.
      </span>
      <button
        type="button" onClick={reset} disabled={!isCustomized}
        style={pillStyle(false, isCustomized)}
      >
        <ArrowCounterClockwise size={13} weight="bold" aria-hidden /> Reset
      </button>
      <button type="button" onClick={onDone} style={pillStyle(true, true)}>
        <Check size={13} weight="bold" aria-hidden /> Done
      </button>
    </div>
  ) : null;

  if (!editing) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {ordered.map((id) => <div key={id}>{byId.get(id)}</div>)}
      </div>
    );
  }

  return (
    <div>
      {toolbar}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ordered} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'grid', gap: 10 }}>
            {ordered.map((id) => (
              <SortableCard key={id} id={id}>{byId.get(id)}</SortableCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function pillStyle(primary: boolean, enabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5, height: 30,
    padding: primary ? '0 14px' : '0 12px', borderRadius: 999,
    border: primary ? 'none' : `1px solid ${BORDER_SOFT}`,
    background: primary ? brandVar : '#fff',
    color: primary ? '#fff' : TEXT_DARK,
    fontFamily: FONT_BODY, fontSize: 12, fontWeight: primary ? 700 : 600,
    cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5,
  };
}

function SortableCard({ id, children }: { id: string; children: ReactNode }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id });
  const style: React.CSSProperties = {
    position: 'relative',
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : undefined,
    opacity: isDragging ? 0.9 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <button
        type="button"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 6,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 34, height: 34, borderRadius: 999, border: 'none',
          background: brandVar, color: '#fff', cursor: 'grab',
          touchAction: 'none', boxShadow: '0 1px 4px rgba(20,20,20,0.25)',
        }}
      >
        <DotsSixVertical size={16} weight="bold" aria-hidden />
      </button>
      {children}
    </div>
  );
}
