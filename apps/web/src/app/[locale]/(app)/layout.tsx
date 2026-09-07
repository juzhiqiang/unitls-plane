import { AppSidebar } from '@/components/layout/app-sidebar';
import { AppHeader } from '@/components/layout/app-header';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        {/* min-h-0 而非 min-h-screen:配合 SidebarInset 的 flex 列,全高页面
            (生图对话页)可以真正贴住视口底,长内容页则靠 flex 自然撑高。 */}
        <main className="flex min-h-0 flex-1 flex-col p-4 lg:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}