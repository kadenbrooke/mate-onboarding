'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';

// Shared "Customize layout" toggle: the entry control now lives in the
// TopBar header (left of the bell), but the actual editing state is
// consumed by DashboardView's grid/stack children further down the tree.
// A small context is the simplest way to connect a header control to
// page content across the dash layout boundary without prop-drilling
// through the Server Component layout.

type DashEditingContextValue = { editing: boolean; setEditing: (v: boolean) => void };

const DashEditingContext = createContext<DashEditingContextValue | null>(null);

export function DashEditingProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return (
    <DashEditingContext.Provider value={{ editing, setEditing }}>
      {children}
    </DashEditingContext.Provider>
  );
}

export function useDashEditing(): DashEditingContextValue {
  const ctx = useContext(DashEditingContext);
  if (!ctx) throw new Error('useDashEditing must be used within DashEditingProvider');
  return ctx;
}
