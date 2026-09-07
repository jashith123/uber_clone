import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { alreadyAsked, disablePush, enablePush, pushPermission, sendTestPush } from '../lib/push';
import type { EmergencyContact } from '../lib/types';

export default function Safety() {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [perm, setPerm] = useState(pushPermission());
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    api<{ contacts: EmergencyContact[] }>('/safety/contacts').then((r) => setContacts(r.contacts)).catch(() => {});
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { contacts } = await api<{ contacts: EmergencyContact[] }>('/safety/contacts', { method: 'POST', body: form });
      setContacts(contacts);
      setForm({ name: '', phone: '' });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    const { contacts } = await api<{ contacts: EmergencyContact[] }>(`/safety/contacts/${id}`, { method: 'DELETE' });
    setContacts(contacts);
  }

  async function togglePush() {
    setPushBusy(true);
    setMsg(null);
    try {
      if (perm === 'granted') {
        await disablePush();
        setMsg('Notifications turned off on this device.');
      } else {
        const ok = await enablePush();
        setMsg(ok ? 'Notifications are on for this device.' : 'Could not turn notifications on. Check the browser permission, or the server may have no push keys.');
      }
      setPerm(pushPermission());
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>Safety and alerts</h1>

      <section className="card form">
        <h2 style={{ margin: 0 }}>Notifications</h2>
        <p className="muted">
          Get told when a driver accepts, arrives, or messages you, even when the app is closed. On iPhone, add the app to your
          Home Screen first.
        </p>
        <div className="row-actions">
          <button className="btn btn-primary" disabled={pushBusy || perm === 'unsupported'} onClick={togglePush}>
            {perm === 'granted' ? 'Turn off on this device' : 'Turn on notifications'}
          </button>
          {perm === 'granted' && (
            <button className="btn btn-light" disabled={pushBusy} onClick={() => sendTestPush().then((r) => setMsg(`Test sent to ${r.sent} device(s).`))}>
              Send a test
            </button>
          )}
        </div>
        <p className="muted">
          Status: <strong>{perm === 'unsupported' ? 'not supported by this browser' : perm}</strong>
          {perm === 'denied' && ' — you will have to allow notifications in the browser settings.'}
          {perm === 'default' && !alreadyAsked() && ' — you have not been asked yet.'}
        </p>
        {msg && <div className="ok">{msg}</div>}
      </section>

      <section className="card form">
        <h2 style={{ margin: 0 }}>Emergency contacts</h2>
        <p className="muted">
          If you press SOS during a ride, these people are shown to you for a one-tap call, along with a link that lets them follow
          the trip live. Up to 5.
        </p>
        <ul className="contact-list">
          {contacts.map((c) => (
            <li key={c.id}>
              <span>
                <strong>{c.name}</strong>
                <small>{c.phone}</small>
              </span>
              <button className="icon-btn" title="Remove" onClick={() => remove(c.id)}>
                ✕
              </button>
            </li>
          ))}
          {contacts.length === 0 && <li className="muted">No contacts saved yet.</li>}
        </ul>
        <form className="grid-2" onSubmit={add}>
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Phone
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required inputMode="tel" />
          </label>
        </form>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-light" onClick={add as unknown as () => void} disabled={!form.name || !form.phone}>
          Add contact
        </button>
      </section>
    </main>
  );
}
