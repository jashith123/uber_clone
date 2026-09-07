import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase, getToken } from '../../lib/api';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import type { DriverDocument } from '../../lib/types';

const KIND_LABEL: Record<string, string> = {
  licence: 'Driving licence',
  rc: 'Vehicle registration (RC)',
  insurance: 'Insurance certificate',
  permit: 'Commercial permit',
  photo: 'Your photo',
};

const STATUS_TEXT: Record<string, string> = {
  approved: 'Approved',
  pending: 'Waiting for review',
  rejected: 'Rejected',
};

export default function DriverDocuments() {
  const { user, refresh } = useAuth();
  const [docs, setDocs] = useState<DriverDocument[]>([]);
  const [required, setRequired] = useState<string[]>([]);
  const [approval, setApproval] = useState<{ approval_status: string; approval_note: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    const r = await api<{ documents: DriverDocument[]; required: string[]; approval: { approval_status: string; approval_note: string | null } }>(
      '/drivers/me/documents',
    );
    setDocs(r.documents);
    setRequired(r.required);
    setApproval(r.approval);
  }, []);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  async function upload(kind: string, file: File, number: string) {
    setBusy(kind);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      if (number) fd.append('number', number);
      const res = await fetch(`${apiBase()}/api/drivers/me/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const status = approval?.approval_status || user?.driver?.approval_status || 'approved';

  return (
    <main className="page narrow">
      <h1>Your documents</h1>

      <div className={`card doc-status doc-${status}`}>
        <strong>{STATUS_TEXT[status] || status}</strong>
        <p className="muted">
          {status === 'approved' && 'You can go online and take rides.'}
          {status === 'pending' && 'An admin is checking your paperwork. You cannot go online until it is approved.'}
          {status === 'rejected' && (approval?.approval_note || 'Something was wrong with your documents. Upload them again.')}
        </p>
      </div>

      <p className="muted">
        Photos or PDFs, up to 8 MB each. Uploading a new file replaces the old one of that type.
      </p>

      <ul className="doc-list">
        {required.map((kind) => {
          const doc = docs.find((d) => d.kind === kind);
          return (
            <li key={kind} className="card">
              <div className="doc-head">
                <div>
                  <strong>{KIND_LABEL[kind] || kind}</strong>
                  {doc ? (
                    <small>
                      Uploaded {formatDate(doc.created_at)}
                      {doc.number ? ` · ${doc.number}` : ''}
                      {doc.review_note ? ` · ${doc.review_note}` : ''}
                    </small>
                  ) : (
                    <small className="muted">Not uploaded</small>
                  )}
                </div>
                <span className={`status-badge status-${doc?.status === 'approved' ? 'completed' : doc?.status === 'rejected' ? 'cancelled' : 'requested'}`}>
                  {doc ? STATUS_TEXT[doc.status] : 'Missing'}
                </span>
              </div>
              <div className="doc-actions">
                <input
                  ref={(el) => {
                    inputs.current[`n_${kind}`] = el;
                  }}
                  className="doc-number"
                  placeholder="Number (optional)"
                  defaultValue={doc?.number || ''}
                />
                <label className="btn btn-light btn-sm">
                  {busy === kind ? 'Uploading…' : doc ? 'Replace' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) upload(kind, f, inputs.current[`n_${kind}`]?.value || '');
                      e.target.value = '';
                    }}
                  />
                </label>
                {doc && (
                  <a className="btn btn-ghost btn-sm" href={`${apiBase()}/api/drivers/me/documents/${doc.id}/file`} target="_blank" rel="noreferrer">
                    View
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <div className="error">{error}</div>}
    </main>
  );
}
