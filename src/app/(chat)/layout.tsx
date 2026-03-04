import { cookies } from 'next/headers';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const userId = cookieStore.get('mmiai-user-id')?.value ?? 'default-user';

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar userId={userId} />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
