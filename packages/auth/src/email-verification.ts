import nodemailer from 'nodemailer';

type Env = Record<string, string | undefined>;

type VerificationUser = {
  email: string;
};

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

export function isEmailVerificationRequired(env: Env = process.env): boolean {
  if (env.REQUIRE_EMAIL_VERIFICATION === 'true') return true;
  if (env.REQUIRE_EMAIL_VERIFICATION === 'false') return false;

  return env.NODE_ENV === 'production';
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is required when email verification is enabled`);
  }
  return trimmed;
}

export function getSmtpConfig(env: Env = process.env): SmtpConfig {
  return {
    host: required(env.SMTP_HOST, 'SMTP_HOST'),
    port: Number.parseInt(env.SMTP_PORT || '587', 10),
    secure: env.SMTP_SECURE === 'true',
    user: required(env.SMTP_USER, 'SMTP_USER'),
    password: required(env.SMTP_PASSWORD, 'SMTP_PASSWORD'),
    from: required(env.SMTP_FROM, 'SMTP_FROM'),
  };
}

export function getEmailVerificationOptions(env: Env = process.env) {
  if (!isEmailVerificationRequired(env)) {
    return {
      sendVerificationEmail: async ({
        user,
        url,
      }: {
        user: VerificationUser;
        url: string;
      }) => {
        if (env.NODE_ENV === 'development') {
          console.log(`[Verify Email] ${user.email}: ${url}`);
        }
      },
    };
  }

  const smtp = getSmtpConfig(env);

  return {
    sendOnSignUp: true,
    sendOnSignIn: true,
    sendVerificationEmail: async ({
      user,
      url,
    }: {
      user: VerificationUser;
      url: string;
    }) => {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.user,
          pass: smtp.password,
        },
      });

      await transporter.sendMail({
        from: smtp.from,
        to: user.email,
        subject: 'Verify your Utils Plane email',
        text: `Click the link below to verify your email:\n\n${url}`,
        html: `<p>Click the link below to verify your email:</p><p><a href="${url}">${url}</a></p>`,
      });
    },
  };
}

