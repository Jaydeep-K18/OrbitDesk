import { Link } from 'react-router';

const COLLECTED = [
  [
    'Account details',
    'Email, name, time zone and a hashed password',
    'Until you delete your account',
  ],
  ['Tasks, plans and sessions', 'What you create in FocusGuard', 'Until you delete them'],
  [
    'Visited domains and time spent',
    'Only during active focus sessions, if tracking is on',
    '180 days (configurable)',
  ],
  [
    'Page titles (optional)',
    'Only if you opt in; scrubbed; never for banking, health, email or messaging',
    'With the activity record',
  ],
  ['Blocked attempts', 'When a blocked site is opened during a session', '180 days'],
  ['Paired devices', 'Name, type, version and last seen time', 'Until you revoke them'],
];

/** Public privacy page (ROADMAP 1.6 privacy v1). */
export function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy at FocusGuard</h1>
      <p className="text-muted-foreground">
        FocusGuard helps you understand how you focus; it is not surveillance. We collect the
        minimum needed, only during focus sessions by default, and you can delete everything at any
        time.
      </p>
      <h2 className="text-xl font-semibold">What we collect, and why</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              Data
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              When
            </th>
            <th scope="col" className="py-2 font-medium">
              Kept for
            </th>
          </tr>
        </thead>
        <tbody>
          {COLLECTED.map(([what, when, kept]) => (
            <tr key={what} className="border-b">
              <td className="py-2 pr-3 font-medium">{what}</td>
              <td className="py-2 pr-3">{when}</td>
              <td className="py-2">{kept}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="text-xl font-semibold">What we never collect</h2>
      <p className="text-muted-foreground">
        Passwords or anything you type into other sites, message or email contents, page bodies,
        full URLs or search queries, screenshots, keystrokes and network packet contents.
      </p>
      <h2 className="text-xl font-semibold">Your controls</h2>
      <p className="text-muted-foreground">
        Turn tracking or page titles off, add “never track” sites, delete activity by time range,
        revoke devices, or delete your account and all data, all from Settings.
      </p>
      <Link to="/" className="text-sm font-medium text-primary hover:underline">
        Back to FocusGuard
      </Link>
    </div>
  );
}
