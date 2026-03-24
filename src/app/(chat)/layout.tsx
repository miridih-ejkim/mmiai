import { cookies } from 'next/headers';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { CanvasProvider } from '@/components/canvas';
import { CanvasPanel } from '@/components/canvas';

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const userId = cookieStore.get('mmiai-user-id')?.value ?? 'default-user';

  return (
    <TooltipProvider>
      <CanvasProvider>
        <SidebarProvider>
          <AppSidebar userId={userId} />
          <SidebarInset>
            <div className="flex h-dvh min-w-0">
              <div className="flex-1 min-w-0">{children}</div>
              <CanvasPanel />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </CanvasProvider>
    </TooltipProvider>
  );
}
