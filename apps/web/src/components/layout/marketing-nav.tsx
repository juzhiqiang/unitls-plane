"use client";

import * as React from "react";
import { Menu, LogOut, Settings, LayoutDashboard } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";

export interface MarketingNavLabels {
  tools: string;
  login: string;
  getStarted: string;
  dashboard: string;
  settings: string;
  logOut: string;
  defaultUser: string;
}

interface MarketingNavProps {
  labels: MarketingNavLabels;
}

export function MarketingNav({ labels }: MarketingNavProps) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const handleSignOut = async () => {
    await signOut();
    setMobileOpen(false);
    router.refresh();
  };

  const userInitial = session
    ? (session.user.name || session.user.email || "U").charAt(0).toUpperCase()
    : "";

  return (
    <>
      {/* Desktop nav */}
      <nav className="hidden sm:flex items-center gap-4">
        <Link
          href="/image"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {labels.tools}
        </Link>

        {isPending ? (
          <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
        ) : session ? (
          <>
            <Link
              href="/dashboard"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {labels.dashboard}
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    {session.user.image ? (
                      <AvatarImage src={session.user.image} alt={session.user.name || ""} />
                    ) : (
                      <AvatarFallback className="text-xs">{userInitial}</AvatarFallback>
                    )}
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {session.user.name || labels.defaultUser}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {session.user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard">
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    <span>{labels.dashboard}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>{labels.settings}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{labels.logOut}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <>
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {labels.login}
            </Link>
            <Button asChild size="sm" className="h-8">
              <Link href="/register">
                {labels.getStarted}
              </Link>
            </Button>
          </>
        )}
      </nav>

      {/* Mobile nav */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild className="sm:hidden">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </SheetTrigger>
        <SheetContent side="right" className="w-64 p-0">
          <nav className="flex flex-col gap-1 p-4 pt-12">
            {session && !isPending && (
              <div className="flex items-center gap-3 px-3 py-3 mb-2 border-b border-border">
                <Avatar className="h-9 w-9">
                  {session.user.image ? (
                    <AvatarImage src={session.user.image} alt={session.user.name || ""} />
                  ) : (
                    <AvatarFallback className="text-xs">{userInitial}</AvatarFallback>
                  )}
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">
                    {session.user.name || labels.defaultUser}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {session.user.email}
                  </p>
                </div>
              </div>
            )}

            <Link
              href="/image"
              onClick={() => setMobileOpen(false)}
              className="flex items-center min-h-11 px-3 text-sm text-foreground hover:bg-muted rounded-md transition-colors"
            >
              {labels.tools}
            </Link>

            {isPending ? null : session ? (
              <>
                <Link
                  href="/dashboard"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center min-h-11 px-3 text-sm text-foreground hover:bg-muted rounded-md transition-colors"
                >
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  {labels.dashboard}
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center min-h-11 px-3 text-sm text-foreground hover:bg-muted rounded-md transition-colors"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  {labels.settings}
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex items-center min-h-11 px-3 text-sm text-foreground hover:bg-muted rounded-md transition-colors text-left"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {labels.logOut}
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center min-h-11 px-3 text-sm text-foreground hover:bg-muted rounded-md transition-colors"
                >
                  {labels.login}
                </Link>
                <Button asChild className="mt-2 w-full h-11">
                  <Link
                    href="/register"
                    onClick={() => setMobileOpen(false)}
                  >
                    {labels.getStarted}
                  </Link>
                </Button>
              </>
            )}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
