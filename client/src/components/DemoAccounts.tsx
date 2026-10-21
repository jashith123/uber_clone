import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface DemoAccount {
  email: string;
  password: string;
  label: string;
  role: 'customer' | 'driver';
  admin?: boolean;
}

/** Every seeded account. The password is the same for all of them. */
const SEEDED: Omit<DemoAccount, 'password'>[] = [
  { email: 'rider@demo.com', label: 'Rider · Asha', role: 'customer' },
  { email: 'rider2@demo.com', label: 'Rider · Rahul', role: 'customer' },
  { email: 'owner@demo.com', label: 'Owner · company books, every account, payouts', role: 'customer', admin: true },
  { email: 'admin@demo.com', label: 'Admin · rides, users, fares, promos, SOS', role: 'customer', admin: true },
  { email: 'moto.driver@demo.com', label: 'Moto driver · Honda Activa (bike)', role: 'driver' },
  { email: 'auto.driver@demo.com', label: 'Auto driver · Bajaj RE (3-wheeler)', role: 'driver' },
  { email: 'car.driver@demo.com', label: 'Car driver · Go · Maruti Swift Dzire', role: 'driver' },
  { email: 'car2.driver@demo.com', label: 'Car driver · Go · Hyundai Aura', role: 'driver' },
  { email: 'comfort.driver@demo.com', label: 'Comfort driver · Honda City', role: 'driver' },
  { email: 'suv.driver@demo.com', label: 'SUV driver · XL · Toyota Innova', role: 'driver' },
];

interface DemoInfo {
  enabled: boolean;
  /** Only sent while the server still uses the default demo password. */
  password: string | null;
}

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
 * The demo credential list. Shown only when the server actually has the demo
 * accounts; the password is shown only while it is still the default. Tapping
 * a row fills the form; the copy buttons put the email or password on the
 * clipboard so they can be pasted anywhere.
 */
export default function DemoAccounts({ role, onUse }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [info, setInfo] = useState<DemoInfo | null>(null);

  useEffect(() => {
    api<DemoInfo>('/auth/demo')
      .then(setInfo)
      .catch(() => setInfo({ enabled: false, password: null }));
  }, []);

  if (!info?.enabled) return null;
  const password = info.password ?? '';
  const accounts: DemoAccount[] = SEEDED.map((a) => ({ ...a, password }));
  const list = role ? accounts.filter((a) => a.role === role) : accounts;

  const flash = async (key: string, text: string) => {
    await copy(text);
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };

  return (
    <div className="demo-box">
      <div className="demo-head">
        <strong>Demo accounts</strong>
        <button
          type="button"
          className="chip"
          onClick={() => flash('all', accounts.map((a) => (password ? `${a.email} / ${password}` : a.email)).join('\n'))}
        >
          {copied === 'all' ? '✓ Copied' : 'Copy all'}
        </button>
      </div>
      <p className="muted demo-note">
        {password ? (
          <>
            Password for every account is <code>{password}</code>. Tap a row to fill the form.
          </>
        ) : (
          <>Ask whoever runs this server for the demo password. Tap a row to fill the email.</>
        )}
      </p>
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
              {password && (
                <button type="button" className="chip" title="Copy the password" onClick={() => flash(`p${a.email}`, password)}>
                  {copied === `p${a.email}` ? '✓' : 'Pass'}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
