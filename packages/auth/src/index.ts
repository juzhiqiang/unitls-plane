import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@utils-plane/db';
import type { Database } from '@utils-plane/db';
import { getTrustedOrigins } from './origins';

export const auth = betterAuth({
  database: drizzleAdapter(db as Database, {
    provider: 'pg',
  }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',
  basePath: '/api/auth',
  trustedOrigins: request =>
    getTrustedOrigins(process.env, request?.headers.get('origin')),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: process.env.NODE_ENV === 'production',
    sendVerificationEmail: async ({
      user,
      url,
    }: {
      user: { email: string };
      url: string;
    }) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Verify Email] ${user.email}: ${url}`);
        return;
      }
      // 生产环境调用邮件服务
    },
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 天
    updateAge: 60 * 60 * 24, // 1 天刷新一次
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  user: {
    additionalFields: {
      plan: {
        type: 'string',
        defaultValue: 'free',
      },
      role: {
        type: 'string',
        defaultValue: 'user',
      },
    },
  },

  advanced: {
    database: {
      generateId: false,
    },
  },
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
export {
  getAllowedCorsOrigins,
  getTrustedOrigins,
  isOriginAllowed,
  normalizeOrigin,
} from './origins';

export async function verifySession(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  return session;
}
