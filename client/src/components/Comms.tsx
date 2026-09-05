/**
 * In-ride communication between customer and driver:
 *  - text chat (persisted, delivered live over the socket)
 *  - in-app voice call (WebRTC audio, signalled over the socket)
 *  - plain phone call fallback (tel: link)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getSocket } from '../lib/socket';
import type { Ride } from '../lib/types';

interface Message {
  id: number;
  ride_id: number;
  sender_id: number;
  sender_name: string;
  body: string;
  created_at: string;
}

type SignalType = 'offer' | 'answer' | 'ice' | 'end' | 'reject' | 'busy';
interface Signal {
  ride_id: number;
  from: number;
  from_name: string;
  type: SignalType;
  payload: unknown;
}

type CallState = 'idle' | 'calling' | 'ringing' | 'connected';

const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export default function Comms({ ride }: { ride: Ride }) {
  const { user } = useAuth();
  const me = user!.id;
  const other = ride.customer_id === me ? ride.driver : ride.customer;

  // ---------------- chat ----------------
  const [messages, setMessages] = useState<Message[]>([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ messages: Message[] }>(`/rides/${ride.id}/messages`).then((r) => setMessages(r.messages)).catch(() => {});
  }, [ride.id]);

  useEffect(() => {
    if (open) {
      setUnread(0);
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [open, messages.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setChatError(null);
    try {
      const { message } = await api<{ message: Message }>(`/rides/${ride.id}/messages`, { method: 'POST', body: { body } });
      setMessages((cur) => (cur.some((m) => m.id === message.id) ? cur : [...cur, message]));
      setText('');
    } catch (e) {
      setChatError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  // ---------------- voice call ----------------
  const [call, setCall] = useState<CallState>('idle');
  const [incoming, setIncoming] = useState<Signal | null>(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [callNote, setCallNote] = useState<string | null>(null);
  const callRef = useRef<CallState>('idle');
  callRef.current = call;
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const audioEl = useRef<HTMLAudioElement>(null);

  const signal = useCallback(
    (type: SignalType, payload?: unknown) => {
      getSocket()?.emit('call:signal', { ride_id: ride.id, type, payload }, (res: { error?: string }) => {
        if (res?.error) setCallNote(res.error);
      });
    },
    [ride.id],
  );

  const teardown = useCallback(() => {
    pc.current?.close();
    pc.current = null;
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    pendingIce.current = [];
    if (audioEl.current) audioEl.current.srcObject = null;
    setCall('idle');
    setIncoming(null);
    setMuted(false);
    setSeconds(0);
  }, []);

  const endCall = useCallback(
    (notifyPeer = true) => {
      if (notifyPeer && callRef.current !== 'idle') signal('end');
      teardown();
    },
    [signal, teardown],
  );

  const createPeer = useCallback(
    async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      local.current = stream;
      const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      stream.getTracks().forEach((t) => peer.addTrack(t, stream));
      peer.onicecandidate = (e) => e.candidate && signal('ice', e.candidate.toJSON());
      peer.ontrack = (e) => {
        if (audioEl.current) {
          audioEl.current.srcObject = e.streams[0];
          audioEl.current.play().catch(() => {});
        }
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') setCall('connected');
        if (['failed', 'closed'].includes(peer.connectionState)) {
          setCallNote('Call ended');
          endCall(false);
        }
      };
      pc.current = peer;
      return peer;
    },
    [signal, endCall],
  );

  async function startCall() {
    setCallNote(null);
    try {
      const peer = await createPeer();
      const offer = await peer.createOffer({ offerToReceiveAudio: true });
      await peer.setLocalDescription(offer);
      signal('offer', offer);
      setCall('calling');
    } catch (e) {
      setCallNote(`Could not start call: ${(e as Error).message}. Microphone access needs HTTPS (or localhost).`);
      teardown();
    }
  }

  async function acceptCall() {
    if (!incoming) return;
    setCallNote(null);
    try {
      const peer = await createPeer();
      await peer.setRemoteDescription(new RTCSessionDescription(incoming.payload as RTCSessionDescriptionInit));
      for (const c of pendingIce.current) await peer.addIceCandidate(c).catch(() => {});
      pendingIce.current = [];
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      signal('answer', answer);
      setIncoming(null);
      setCall('connected');
    } catch (e) {
      setCallNote(`Could not answer: ${(e as Error).message}`);
      signal('reject');
      teardown();
    }
  }

  function rejectCall() {
    signal('reject');
    teardown();
  }

  function toggleMute() {
    const next = !muted;
    local.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }

  // Socket subscriptions for chat + signalling.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onMsg = (m: Message) => {
      if (m.ride_id !== ride.id) return;
      setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
      if (!openRef.current && m.sender_id !== me) setUnread((n) => n + 1);
    };
    const onSignal = async (sig: Signal) => {
      if (sig.ride_id !== ride.id) return;
      switch (sig.type) {
        case 'offer':
          if (callRef.current !== 'idle') return signal('busy');
          pendingIce.current = [];
          setIncoming(sig);
          setCall('ringing');
          break;
        case 'answer':
          if (pc.current && !pc.current.currentRemoteDescription) {
            await pc.current.setRemoteDescription(new RTCSessionDescription(sig.payload as RTCSessionDescriptionInit));
            for (const c of pendingIce.current) await pc.current.addIceCandidate(c).catch(() => {});
            pendingIce.current = [];
            setCall('connected');
          }
          break;
        case 'ice':
          if (pc.current?.remoteDescription) await pc.current.addIceCandidate(sig.payload as RTCIceCandidateInit).catch(() => {});
          else pendingIce.current.push(sig.payload as RTCIceCandidateInit);
          break;
        case 'end':
          setCallNote('Call ended');
          teardown();
          break;
        case 'reject':
          setCallNote(`${sig.from_name} declined the call`);
          teardown();
          break;
        case 'busy':
          setCallNote(`${sig.from_name} is on another call`);
          teardown();
          break;
      }
    };
    s.on('chat:message', onMsg);
    s.on('call:signal', onSignal);
    return () => {
      s.off('chat:message', onMsg);
      s.off('call:signal', onSignal);
    };
  }, [ride.id, me, signal, teardown]);

  // Call timer + cleanup on unmount / ride end.
  useEffect(() => {
    if (call !== 'connected') return;
    const t = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [call]);
  useEffect(() => () => endCall(true), [endCall]);

  if (!other) return null;
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="comms">
      <audio ref={audioEl} autoPlay playsInline />

      {call === 'ringing' && incoming && (
        <div className="call-banner ringing">
          <div>
            <strong>Incoming call</strong>
            <small>{incoming.from_name}</small>
          </div>
          <button className="btn btn-primary btn-sm" onClick={acceptCall}>
            Answer
          </button>
          <button className="btn btn-danger-ghost btn-sm" onClick={rejectCall}>
            Decline
          </button>
        </div>
      )}
      {(call === 'calling' || call === 'connected') && (
        <div className="call-banner">
          <div>
            <strong>{call === 'calling' ? 'Calling…' : 'On call'}</strong>
            <small>
              {other.name}
              {call === 'connected' ? ` · ${mm}:${ss}` : ''}
            </small>
          </div>
          {call === 'connected' && (
            <button className="btn btn-light btn-sm" onClick={toggleMute}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => endCall(true)}>
            Hang up
          </button>
        </div>
      )}
      {callNote && call === 'idle' && <div className="call-note">{callNote}</div>}

      <div className="comms-actions">
        <button className="btn btn-light btn-sm" onClick={() => setOpen(!open)}>
          💬 Message{unread > 0 ? ` (${unread})` : ''}
        </button>
        <button className="btn btn-light btn-sm" disabled={call !== 'idle'} onClick={startCall}>
          📞 Call in app
        </button>
        {other.phone && (
          <a className="btn btn-ghost btn-sm" href={`tel:${other.phone}`}>
            Phone
          </a>
        )}
      </div>

      {open && (
        <div className="chat">
          <div className="chat-list" ref={listRef}>
            {messages.length === 0 && <p className="muted">Say hello to {other.name}.</p>}
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.sender_id === me ? 'mine' : ''}`}>
                <span>{m.body}</span>
                <small>{new Date(m.created_at.endsWith('Z') ? m.created_at : `${m.created_at}Z`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
              </div>
            ))}
          </div>
          {chatError && <div className="error">{chatError}</div>}
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${other.name}…`} maxLength={1000} />
            <button className="btn btn-primary btn-sm" disabled={sending || !text.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
