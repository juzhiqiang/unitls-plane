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
  // flex 列:让 main 内的全高页面(如生图对话页)能用 min-h-0 + flex-1 占满,
  // 而不是被 min-h-screen 撑出一段永远滚不到底的空白。
  return (
    <div className="flex min-h-screen flex-1 flex-col lg:ml-60 min-w-0">
      {children}
    </div>
  );
}
