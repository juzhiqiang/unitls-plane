import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';

/**
 * 「未登录就跳登录页」的守卫,在 20 个服务端工具页逐字重复:
 *   if (!session) {
 *     const next = encodeURIComponent('/pdf/merge');
 *     router.push(`/login?next=${next}`);
 *     return;
 *   }
 * 抽成 hook 后页面只剩 `if (requireLogin()) return;`。
 *
 * sessionLoading 用于忽略「会话还在加载」的窗口期,避免页面一挂载就把
 * 已登录用户误判成未登录跳走(与各页面现有逻辑一致)。
 */
export function useRequireLogin() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();

  /**
   * 若未登录则跳登录页并返回 true,调用方据此 early-return;
   * 已登录或会话仍在加载时返回 false。
   * @param returnUrl 登录后回到的路径,默认用当前 pathname。
   */
  function requireLogin(returnUrl?: string): boolean {
    if (sessionLoading || session) return false;
    const next = encodeURIComponent(returnUrl ?? window.location.pathname);
    router.push(`/login?next=${next}`);
    return true;
  }

  return { session, sessionLoading, requireLogin };
}
