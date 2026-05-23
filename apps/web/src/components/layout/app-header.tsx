"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Sun, Moon, Monitor, LogOut, Settings } from "lucide-react";
import { LocaleSwitcher } from "@/components/locale-switcher";

export function AppHeader() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [mounted, setMounted] = React.useState(false);
  const tNav = useTranslations("Nav");
  const tLayout = useTranslations("AppLayout");

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const cycleTheme = () => {
    if (theme === "dark") {
      setTheme("light");
    } else if (theme === "light") {
      setTheme("system");
    } else {
      setTheme("dark");
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
    router.refresh();
  };

  const ThemeIcon = mounted
    ? theme === "dark"
      ? Moon
      : theme === "light"
        ? Sun
        : Monitor
    : Sun;

  const getRouteName = (href: string, fallback: string) => {
    switch (href) {
      case "/image":
        return tNav("imageTools");
      case "/pdf":
        return tNav("pdfTools");
      case "/font":
        return tNav("fontTools");
      case "/files":
        return tNav("myFiles");
      case "/tasks":
        return tNav("taskHistory");
      case "/dashboard":
        return tNav("dashboard");
      default:
        return fallback;
    }
  };

  // Build breadcrumb items
  const pathSegments = pathname.split("/").filter(Boolean);
  const breadcrumbs = pathSegments.map((segment, index) => {
    const href = "/" + pathSegments.slice(0, index + 1).join("/");
    const isLast = index === pathSegments.length - 1;
    const fallback = segment.charAt(0).toUpperCase() + segment.slice(1);
    const name = getRouteName(href, fallback);
    return { href, name, isLast };
  });

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-card px-4 lg:px-6">
      {/* Breadcrumb */}
      <div className="flex-1">
        {pathname !== "/" && (
          <Breadcrumb>
            <BreadcrumbItem>
              <BreadcrumbLink href="/dashboard">{tLayout("home")}</BreadcrumbLink>
            </BreadcrumbItem>
            {breadcrumbs.map((crumb) => (
              <React.Fragment key={crumb.href}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {crumb.isLast ? (
                    <BreadcrumbPage>{crumb.name}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink href={crumb.href}>{crumb.name}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </Breadcrumb>
        )}
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-2">
        {/* Locale Switcher */}
        <LocaleSwitcher />

        {/* Theme Toggle */}
        <button
          onClick={cycleTheme}
          className="flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label={tLayout("toggleTheme")}
        >
          <ThemeIcon className="h-4 w-4" strokeWidth={1.5} />
        </button>

        {/* User Menu */}
        {isPending ? (
          <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
        ) : session ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {(session.user.name || session.user.email || "U").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {session.user.name || tLayout("defaultUser")}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {session.user.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>{tLayout("settings")}</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>{tLayout("logOut")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href="/login">{tLayout("signIn")}</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
