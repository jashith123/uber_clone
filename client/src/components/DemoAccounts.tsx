import { useState } from 'react';

export interface DemoAccount {
  email: string;
  password: string;
  label: string;
  role: 'customer' | 'driver';
  admin?: boolean;
}

/** Every seeded account. Password is the same for all of them. */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'customer@demo.com', password: 'password', label: 'Rider · Asha', role: 'customer' },
  { email: 'rider2@demo.com', password: 'password', label: 'Rider · Rahul', role: 'customer' },
  { email: 'admin@demo.com', password: 'password', label: 'Rider + Admin panel', role: 'customer', admin: true },
  { email: 'driver@demo.com', password: 'password', label: 'Driver · Go (Swift Dzire)', role: 'driver' },
  { email: 'driver2@demo.com', password: 'password', label: 'Driver · Comfort (Honda City)', role: 'driver' },
  { email: 'driver3@demo.com', password: 'password', label: 'Driver · XL (Innova)', role: 'driver' },
  { email: 'driver4@demo.com', password: 'password', label: 'Driver · Go (Hyundai Aura)', role: 'driver' },
];

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard is blocked on plain HTTP in some browsers; fall back to a prompt.
    window.prompt('Copy this:', text);
    return false;
  }
}

interface Props {
  role?: 'customer' | 'driver';
  onUse?: (a: DemoAccount) => void;
}

/**
 * The demo credential list. Tapping a row fills the form; the copy buttons put
 * the email or password on the clipboard so they can be pasted anywhere.
 */
export default function DemoAccounts({ role, onUse }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const list = role ? DEMO_ACCOUNTS.filter((a) => a.role === role) : DEMO_ACCOUNTS;

  const flash = async (key: string, text: string) => {
    await copy(text);
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };

  return (
    <div className="demo-box">
      <div className="demo-head">
        <strong>Demo accounts</strong>
        <button type="button" className="chip" onClick={() => flash('all', DEMO_ACCOUNTS.map((a) => `${a.email} / ${a.password}`).join('\n'))}>
          {copied === 'all' ? '✓ Copied' : 'Copy all'}
        </button>
      </div>
      <p className="muted demo-note">Password for every account is <code>password</code>. Tap a row to fill the form.</p>
      <ul className="demo-list">
        {list.map((a) => (
          <li key={a.email}>
            <button type="button" className="demo-fill" onClick={() => onUse?.(a)} title="Fill the login form">
              <span className="demo-email">{a.email}</span>
              <small>{a.label}</small>
            </button>
            <span className="demo-copies">
              <button type="button" className="chip" title="Copy the email" onClick={() => flash(`e${a.email}`, a.email)}>
                {copied === `e${a.email}` ? '✓' : 'Email'}
              </button>
              <button type="button" className="chip" title="Copy the password" onClick={() => flash(`p${a.email}`, a.password)}>
                {copied === `p${a.email}` ? '✓' : 'Pass'}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
