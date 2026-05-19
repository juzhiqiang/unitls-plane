'use client';

import { useSession } from '@/lib/auth-client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function VerifyEmailPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!isPending && session) {
      // If already logged in, redirect to dashboard
      router.push('/dashboard');
    }
  }, [session, isPending, router]);

  if (isPending) {
    return (
      <div className="w-full max-w-md p-6">
        <div className="border border-border rounded-lg p-6 text-center">
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-6">
      <div className="border border-border rounded-lg p-6 text-center">
        <h1 className="text-2xl font-bold mb-4">验证邮箱</h1>
        <p className="text-muted-foreground mb-4">
          我们已向您的邮箱发送了一封验证邮件。请查收并点击链接完成验证。
        </p>
        <p className="text-sm text-muted-foreground">
          如果没有收到邮件，请检查垃圾邮件文件夹。
        </p>
        <div className="mt-6">
          <a
            href="/login"
            className="text-sm text-primary hover:underline"
          >
            返回登录
          </a>
        </div>
      </div>
    </div>
  );
}