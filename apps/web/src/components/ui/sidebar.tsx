"use client";

import * as React from "react";
import { createContext, useContext } from "react";

interface SidebarContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

interface SidebarProviderProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function SidebarProvider({ children, defaultOpen = true }: SidebarProviderProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <SidebarContext.Provider value={{ open, setOpen, mobileOpen, setMobileOpen }}>
      <div className="flex min-h-screen">{children}</div>
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

interface SidebarInsetProps {
  children: React.ReactNode;
}

export function SidebarInset({ children }: SidebarInsetProps) {
  return (
    <div className="flex-1 lg:ml-60 min-w-0">
      {children}
    </div>
  );
}
