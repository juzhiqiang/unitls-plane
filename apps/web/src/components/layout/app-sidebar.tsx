"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  Image,
  FileType,
  Type,
  FolderOpen,
  History,
  LayoutDashboard,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";

const navigation = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "imageTools", href: "/image", icon: Image },
  { key: "pdfTools", href: "/pdf", icon: FileType },
  { key: "fontTools", href: "/font", icon: Type },
  { key: "myFiles", href: "/files", icon: FolderOpen },
  { key: "taskHistory", href: "/tasks", icon: History },
] as const;

interface AppSidebarProps {
  className?: string;
}

export function AppSidebar({ className }: AppSidebarProps) {
  const pathname = usePathname();
  const tNav = useTranslations("Nav");
  const { mobileOpen, setMobileOpen } = useSidebar();

  const NavContent = () => (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2"
        >
          <div className="h-6 w-6 rounded-sm bg-accent" />
          <span className="font-medium text-foreground">Utils Plane</span>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const name = tNav(item.key);
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-sm transition-colors relative min-h-11",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 bg-accent rounded-r" />
              )}
              <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              <span>{name}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );

  return (
    <>
      {/* Mobile Sheet (controlled via context) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-60 p-0 border-r">
          <NavContent />
        </SheetContent>
      </Sheet>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden lg:flex fixed left-0 top-0 z-40 h-screen w-60 flex-col border-r border-border bg-card",
          className
        )}
      >
        <NavContent />
      </aside>
    </>
  );
}
