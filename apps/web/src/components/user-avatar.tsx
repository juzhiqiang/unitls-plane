'use client';

import { useSession } from '@/lib/auth-client';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export function UserAvatar() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
    );
  }

  if (!session) {
    return null;
  }

  const name = session.user.name || session.user.email || 'U';
  const initial = name.charAt(0).toUpperCase();

  return (
    <Avatar className="h-8 w-8">
      <AvatarFallback className="text-xs">{initial}</AvatarFallback>
    </Avatar>
  );
}