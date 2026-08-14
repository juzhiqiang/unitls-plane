'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  useSession,
  authClient,
  changePassword,
  signOut,
} from '@/lib/auth-client';
import {
  downloadAccountExport,
  useDeleteAccount,
} from '@/hooks/api/use-account';
import { useUploadFile, type FileRecord } from '@/hooks/api/use-files';
import { useRouter } from '@/i18n/navigation';
import { useInstallApp } from '@/components/pwa/install-provider';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Camera, Download, Trash2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const PLAN_LABEL_KEYS = {
  free: 'free',
  pro_preview: 'pro_preview',
  pro: 'pro',
  team: 'team',
  private: 'private',
} as const;

export default function SettingsPage() {
  const t = useTranslations('Settings');
  const router = useRouter();
  const { canInstall, install } = useInstallApp();
  const { data: session, isPending, refetch } = useSession();
  const uploadFile = useUploadFile();
  const deleteAccount = useDeleteAccount();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deletionInFlightRef = useRef(false);
  const installInFlightRef = useRef(false);

  const [name, setName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [nameInitialized, setNameInitialized] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [installingApp, setInstallingApp] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [exportStatus, setExportStatus] = useState<
    'idle' | 'preparing' | 'started' | 'failed'
  >('idle');
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [deletionStatus, setDeletionStatus] = useState<
    'idle' | 'deleting' | 'success' | 'failed'
  >('idle');

  // Initialize name from session once it loads.
  if (session && !nameInitialized) {
    setName(session.user.name ?? '');
    setNameInitialized(true);
  }

  if (isPending) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="h-8 w-32 rounded bg-muted animate-pulse" />
        <div className="h-48 rounded-lg bg-muted animate-pulse" />
        <div className="h-48 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const user = session.user;
  const userPlan = ((user as { plan?: string }).plan ?? 'free')
    .trim()
    .toLowerCase();
  const planLabelKey = Object.prototype.hasOwnProperty.call(
    PLAN_LABEL_KEYS,
    userPlan
  )
    ? PLAN_LABEL_KEYS[userPlan as keyof typeof PLAN_LABEL_KEYS]
    : 'unknown';
  const planLabel = t(`account.planValues.${planLabelKey}`);
  const initial = (user.name || user.email || 'U').charAt(0).toUpperCase();

  const handleAvatarPick = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error(t('errors.uploadInvalidType'));
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(t('errors.uploadTooLarge'));
      return;
    }

    setUploadingAvatar(true);
    try {
      const uploaded = (await uploadFile.mutateAsync(
        file
      )) as unknown as FileRecord;
      const imageUrl = `${API_URL}/files/${uploaded.id}/download`;
      const { error } = await authClient.updateUser({ image: imageUrl });
      if (error) throw error;
      await refetch();
      toast.success(t('profile.updated'));
    } catch {
      toast.error(t('errors.uploadFailed'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const { error } = await authClient.updateUser({ name });
      if (error) throw error;
      await refetch();
      toast.success(t('profile.updated'));
    } catch (err) {
      toast.error((err as Error)?.message || t('errors.uploadFailed'));
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (newPassword.length < 8) {
      setPasswordError(t('password.tooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('password.mismatch'));
      return;
    }

    setSavingPassword(true);
    try {
      const { error } = await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (error) {
        setPasswordError(error.message || '');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success(t('password.updated'));
    } finally {
      setSavingPassword(false);
    }
  };

  const handleAccountExport = async () => {
    setExportStatus('preparing');
    try {
      await downloadAccountExport();
      setExportStatus('started');
    } catch {
      setExportStatus('failed');
    }
  };

  const handleInstallApp = async () => {
    if (installInFlightRef.current) return;

    installInFlightRef.current = true;
    setInstallingApp(true);
    try {
      const outcome = await install();
      if (outcome === 'accepted') {
        toast.success(t('application.installed'));
      }
    } catch {
      toast.error(t('application.installFailed'));
    } finally {
      installInFlightRef.current = false;
      setInstallingApp(false);
    }
  };

  const normalizedConfirmationEmail = confirmationEmail.trim().toLowerCase();
  const emailMatches =
    normalizedConfirmationEmail === user.email.trim().toLowerCase();
  const deletionPending =
    deletionStatus === 'deleting' || deleteAccount.isPending;

  const handleAccountDeletion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !emailMatches ||
      deletionPending ||
      deletionStatus === 'success' ||
      deletionInFlightRef.current
    )
      return;

    deletionInFlightRef.current = true;
    setDeletionStatus('deleting');
    try {
      await deleteAccount.mutateAsync(normalizedConfirmationEmail);
      setDeletionStatus('success');
      await signOut().catch(() => undefined);
      router.replace('/');
      router.refresh();
    } catch {
      deletionInFlightRef.current = false;
      setDeletionStatus('failed');
    }
  };

  const createdAt = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString()
    : '-';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-medium">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      {/* Profile */}
      <Card>
        <CardTitle>{t('profile.title')}</CardTitle>
        <Separator className="my-4" />

        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            {user.image ? (
              <AvatarImage src={user.image} alt={user.name || ''} />
            ) : (
              <AvatarFallback className="text-lg">{initial}</AvatarFallback>
            )}
          </Avatar>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAvatarPick}
              disabled={uploadingAvatar}
            >
              <Camera className="mr-2 h-4 w-4" />
              {uploadingAvatar
                ? t('profile.avatarUploading')
                : t('profile.avatarUpload')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
        </div>

        <form onSubmit={handleProfileSave} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t('profile.name')}</Label>
            <Input
              id="name"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('profile.email')}</Label>
            <Input id="email" value={user.email} readOnly disabled />
          </div>
          <Button type="submit" disabled={savingProfile}>
            {savingProfile ? t('profile.saving') : t('profile.save')}
          </Button>
        </form>
      </Card>

      {/* Password */}
      <Card>
        <CardTitle>{t('password.title')}</CardTitle>
        <Separator className="my-4" />

        <form onSubmit={handlePasswordSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">{t('password.current')}</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">{t('password.new')}</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">{t('password.confirm')}</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          {passwordError && (
            <p className="text-sm text-destructive">{passwordError}</p>
          )}
          <Button type="submit" disabled={savingPassword}>
            {savingPassword ? t('password.submitting') : t('password.submit')}
          </Button>
        </form>
      </Card>

      {/* Account info */}
      <Card>
        <CardTitle>{t('account.title')}</CardTitle>
        <Separator className="my-4" />

        <dl className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t('account.createdAt')}</dt>
            <dd>{createdAt}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t('account.plan')}</dt>
            <dd>{planLabel}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">
              {t('account.emailVerified')}
            </dt>
            <dd>
              <span
                className={
                  user.emailVerified
                    ? 'inline-flex items-center rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent'
                    : 'inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                }
              >
                {user.emailVerified
                  ? t('account.verified')
                  : t('account.unverified')}
              </span>
            </dd>
          </div>
        </dl>

        {canInstall && (
          <>
            <Separator className="my-4" />
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">{t('application.title')}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('application.installDescription')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleInstallApp}
                disabled={installingApp}
              >
                <Download className="h-4 w-4" />
                {installingApp
                  ? t('application.installing')
                  : t('application.installAction')}
              </Button>
            </div>
          </>
        )}

        <Separator className="my-4" />
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">{t('account.exportTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('account.exportDescription')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleAccountExport}
            disabled={exportStatus === 'preparing'}
          >
            <Download className="h-4 w-4" />
            {exportStatus === 'preparing'
              ? t('account.exportPreparing')
              : exportStatus === 'failed'
                ? t('account.exportRetry')
                : exportStatus === 'started'
                  ? t('account.exportAgain')
                  : t('account.exportAction')}
          </Button>
          {exportStatus === 'started' && (
            <p
              role="status"
              aria-label={t('account.exportSuccess')}
              className="text-sm text-accent"
            >
              {t('account.exportSuccess')}
            </p>
          )}
          {exportStatus === 'failed' && (
            <p role="alert" className="text-sm text-destructive">
              {t('account.exportFailed')}
            </p>
          )}
        </div>
      </Card>

      <Card className="border-destructive/50">
        <CardTitle className="text-destructive">{t('danger.title')}</CardTitle>
        <Separator className="my-4" />

        <form onSubmit={handleAccountDeletion} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">{t('danger.warning')}</p>
          <div className="space-y-1.5">
            <Label htmlFor="deleteConfirmationEmail">
              {t('danger.confirmationLabel', { email: user.email })}
            </Label>
            <Input
              id="deleteConfirmationEmail"
              type="email"
              autoComplete="off"
              value={confirmationEmail}
              onChange={event => setConfirmationEmail(event.target.value)}
              disabled={deletionPending || deletionStatus === 'success'}
            />
            <p className="text-xs text-muted-foreground">
              {t('danger.confirmationHint')}
            </p>
          </div>

          {deletionStatus === 'deleting' && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('danger.deleting')}
            </p>
          )}
          {deletionStatus === 'success' && (
            <p role="status" className="text-sm text-accent">
              {t('danger.success')}
            </p>
          )}
          {deletionStatus === 'failed' && (
            <p role="alert" className="text-sm text-destructive">
              {t('danger.failed')}
            </p>
          )}

          <Button
            type="submit"
            variant="destructive"
            disabled={
              !emailMatches || deletionPending || deletionStatus === 'success'
            }
          >
            <Trash2 className="h-4 w-4" />
            {deletionStatus === 'deleting'
              ? t('danger.deletingAction')
              : deletionStatus === 'success'
                ? t('danger.deletedAction')
                : deletionStatus === 'failed'
                  ? t('danger.retry')
                  : t('danger.action')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
