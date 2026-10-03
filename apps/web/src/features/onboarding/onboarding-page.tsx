import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle2, Circle } from 'lucide-react';
import { api } from '@/lib/api';
import { EXTENSION_ID, pairExtension, pingExtension, type ExtensionStatus } from '@/lib/extension';
import { useUpdateSettings } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/primitives';

function Step({
  done,
  title,
  children,
}: {
  done: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-xl border bg-card p-5 shadow-sm">
      {done ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-planned" aria-label="Done" />
      ) : (
        <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-label="To do" />
      )}
      <div className="space-y-2">
        <h2 className="font-medium">{title}</h2>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

/** Onboarding: install the extension → pair → first session (ROADMAP 1.3). */
export function OnboardingPage() {
  const [ext, setExt] = useState<ExtensionStatus | 'checking'>('checking');
  const [titles, setTitles] = useState(false);
  const settings = useUpdateSettings();

  useEffect(() => {
    const check = () => void pingExtension().then(setExt);
    check();
    const id = setInterval(check, 3000);
    return () => clearInterval(id);
  }, []);

  const pair = async () => {
    const { code } = await api<{ code: string }>('/devices/pairing-codes', { method: 'POST' });
    const res = await pairExtension(code);
    if (res?.ok) {
      setExt('connected');
      toast.success('Extension connected');
    } else
      toast.error(
        `Pairing didn't complete. Enter code ${code.slice(0, 4)}-${code.slice(4)} in the extension options.`,
      );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Set up FocusGuard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Three quick steps and you're ready to focus.
        </p>
      </div>
      <ol className="space-y-3">
        <Step
          done={ext !== 'not_installed' && ext !== 'checking'}
          title="1. Install the Chrome extension"
        >
          <p>
            Developer build: open <code>chrome://extensions</code>, enable Developer mode, click
            “Load unpacked” and choose <code>apps/extension/.output/chrome-mv3-dev</code>. Expected
            ID: <code>{EXTENSION_ID}</code>.
          </p>
          <p>
            To block in incognito windows too, enable “Allow in Incognito” on the extension's
            details page.
          </p>
        </Step>
        <Step done={ext === 'connected'} title="2. Connect it to your account">
          <Button
            size="sm"
            onClick={() => void pair()}
            disabled={ext === 'not_installed' || ext === 'connected'}
          >
            {ext === 'connected' ? 'Connected' : 'Connect extension'}
          </Button>
        </Step>
        <Step done={false} title="3. Choose how smart classification should be">
          <label className="flex items-start gap-3">
            <Switch
              checked={titles}
              onCheckedChange={(v) => {
                setTitles(v);
                settings.mutate({ titleCollectionEnabled: v });
              }}
              aria-label="Use page titles for context-aware classification"
            />
            <span>
              Use page titles so FocusGuard can tell a Binary Search tutorial on YouTube from
              entertainment. Off by default; never used for banking, health, email or messaging
              sites.
            </span>
          </label>
        </Step>
      </ol>
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link to="/">Skip for now</Link>
        </Button>
        <Button asChild>
          <Link to="/sessions/new">Start your first session</Link>
        </Button>
      </div>
    </div>
  );
}
