import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { UserSettings } from '@focusguard/contracts';
import { useAuth } from '@/lib/auth';
import { api, ApiError, tokens } from '@/lib/api';
import { qk, useDevices, useSettings, useUpdateProfile, useUpdateSettings } from '@/lib/queries';
import { pairExtension, pingExtension, type ExtensionStatus } from '@/lib/extension';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import {
  Badge,
  Dialog,
  DialogContent,
  PageHeader,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';

const TIMEZONES: string[] =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York'];

function AccountTab() {
  const { user, setUser, logout } = useAuth();
  const update = useUpdateProfile();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.displayName ?? '');
  const [tz, setTz] = useState(user?.timezone ?? 'UTC');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState('');

  const saveProfile = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      { displayName: name, timezone: tz },
      {
        onSuccess: (u) => (setUser(u), toast.success('Profile saved')),
        onError: () => toast.error('Could not save profile'),
      },
    );
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    try {
      await api('/me/change-password', {
        method: 'POST',
        body: { currentPassword: pw.current, newPassword: pw.next },
      });
      setPw({ current: '', next: '' });
      toast.success('Password changed. Other sessions were signed out.');
    } catch (err) {
      setPwError(
        err instanceof ApiError
          ? (err.fieldErrors().newPassword ?? err.message)
          : 'Could not change password',
      );
    }
  };

  const deleteAccount = async () => {
    try {
      await api('/me', { method: 'DELETE', body: { password: deletePw, confirm: true } });
      tokens.set(null);
      toast('Your account and all data were deleted.');
      navigate('/login');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete account');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <Field label="Name">
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Time zone" hint="Used for daily stats and scheduling.">
              {(p) => (
                <Select {...p} value={tz} onChange={(e) => setTz(e.target.value)}>
                  {TIMEZONES.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <p className="text-sm text-muted-foreground">
              Email: {user?.email}{' '}
              {user?.emailVerified ? (
                <Badge className="bg-planned/15 text-planned">verified</Badge>
              ) : (
                <ResendVerification />
              )}
            </p>
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-4">
            <Field label="Current password">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  value={pw.current}
                  onChange={(e) => setPw({ ...pw, current: e.target.value })}
                />
              )}
            </Field>
            <Field label="New password" error={pwError ?? undefined} hint="At least 10 characters.">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })}
                />
              )}
            </Field>
            <Button type="submit" variant="secondary" disabled={!pw.current || !pw.next}>
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2 border-destructive/40">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void api('/auth/logout-all', { method: 'POST' }).then(() => logout())}
          >
            Log out everywhere
          </Button>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete account
            </Button>
            <DialogContent
              title="Delete your account?"
              description="This permanently deletes your account, sessions, activity and reports. It cannot be undone."
            >
              <Field label="Confirm with your password">
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    value={deletePw}
                    onChange={(e) => setDeletePw(e.target.value)}
                  />
                )}
              </Field>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={!deletePw}
                  onClick={() => void deleteAccount()}
                >
                  Delete everything
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}

function ResendVerification() {
  const [sent, setSent] = useState(false);
  return (
    <button
      className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
      disabled={sent}
      onClick={() =>
        void api('/auth/resend-verification', { method: 'POST' }).then(() => setSent(true))
      }
    >
      {sent ? 'Verification email sent' : 'Resend verification email'}
    </button>
  );
}

function PrivacyTab() {
  const { data, isLoading } = useSettings();
  const update = useUpdateSettings();
  const [range, setRange] = useState('7');
  if (isLoading || !data) return <Skeleton className="h-64" />;
  const toggle = (key: keyof UserSettings) => (checked: boolean) =>
    update.mutate({ [key]: checked });

  const deleteHistory = async () => {
    const to = new Date();
    const from =
      range === 'all' ? new Date(0) : new Date(to.getTime() - Number(range) * 86_400_000);
    const res = await api<{ deletedSegments: number; deletedBlockedAttempts: number }>(
      '/activity',
      {
        method: 'DELETE',
        query: { from: from.toISOString(), to: to.toISOString() },
      },
    );
    toast.success(
      `Deleted ${res.deletedSegments} activity records and ${res.deletedBlockedAttempts} blocked attempts.`,
    );
  };

  const rows: { key: keyof UserSettings; title: string; description: string }[] = [
    {
      key: 'trackingEnabled',
      title: 'Track browser activity during sessions',
      description:
        'Domains and time spent, only while a focus session is running. Blocking works even when this is off.',
    },
    {
      key: 'titleCollectionEnabled',
      title: 'Context-aware classification (page titles)',
      description:
        'Lets FocusGuard tell a tutorial video from entertainment. Titles are scrubbed of emails and numbers and never collected for banking, health, email or messaging sites.',
    },
    {
      key: 'widgetEnabled',
      title: 'Show the floating timer widget',
      description: 'A small square on the side of pages that shows remaining time when clicked.',
    },
    {
      key: 'blockDuringBreaks',
      title: 'Keep blocking during breaks',
      description: 'Default for new sessions.',
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>What FocusGuard collects</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {rows.map((r) => (
            <div key={r.key} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium" id={`lbl-${r.key}`}>
                  {r.title}
                </p>
                <p className="text-xs text-muted-foreground">{r.description}</p>
              </div>
              <Switch
                checked={Boolean(data[r.key])}
                onCheckedChange={toggle(r.key)}
                aria-labelledby={`lbl-${r.key}`}
              />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Never collected</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Passwords or anything you type, message or email contents, page bodies, full URLs or
          search queries, screenshots and keystrokes. Use the Domains page to add sites FocusGuard
          should never track.
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Delete activity history</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Range to delete"
            className="w-40"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="all">Everything</option>
          </Select>
          <Button variant="destructive" onClick={() => void deleteHistory()}>
            Delete
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DevicesTab() {
  const devices = useDevices();
  const qc = useQueryClient();
  const [ext, setExt] = useState<ExtensionStatus | 'checking'>('checking');
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);

  useEffect(() => {
    void pingExtension().then(setExt);
  }, []);

  const connect = async () => {
    const created = await api<{ code: string; expiresAt: string }>('/devices/pairing-codes', {
      method: 'POST',
    });
    setCode(created);
    const res = await pairExtension(created.code);
    if (res?.ok) {
      toast.success('Extension connected');
      setCode(null);
      setExt('connected');
      void qc.invalidateQueries({ queryKey: qk.devices });
    }
  };

  const revoke = async (id: string) => {
    await api(`/devices/${id}`, { method: 'DELETE' });
    toast('Device disconnected');
    void qc.invalidateQueries({ queryKey: qk.devices });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Chrome extension</CardTitle>
          <p className="text-xs text-muted-foreground">
            Status:{' '}
            {ext === 'checking'
              ? 'checking…'
              : ext === 'connected'
                ? 'connected'
                : ext === 'not_paired'
                  ? 'installed, not paired'
                  : 'not detected'}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={() => void connect()}>Connect extension</Button>
          {code ? (
            <div className="rounded-lg border border-dashed p-4" aria-live="polite">
              <p className="text-sm">
                If the extension didn't connect automatically, open its options page and enter this
                code:
              </p>
              <p className="mt-2 font-mono text-2xl tracking-widest">
                {code.code.slice(0, 4)}-{code.code.slice(4)}
              </p>
              <p className="text-xs text-muted-foreground">
                Expires at {new Date(code.expiresAt).toLocaleTimeString()}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Paired devices</CardTitle>
        </CardHeader>
        <CardContent>
          {devices.isLoading ? (
            <Skeleton className="h-20" />
          ) : devices.data?.items.length ? (
            <ul className="divide-y text-sm">
              {devices.data.items.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.type} · {d.version ?? 'unknown version'} · last seen{' '}
                      {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'never'}
                    </p>
                  </div>
                  {d.revokedAt ? (
                    <Badge className="bg-muted text-muted-foreground">Revoked</Badge>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => void revoke(d.id)}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No devices paired yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" />
      <Tabs defaultValue="account">
        <TabsList aria-label="Settings sections" className="mb-6">
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="privacy">Privacy</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        <TabsContent value="privacy">
          <PrivacyTab />
        </TabsContent>
        <TabsContent value="devices">
          <DevicesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
