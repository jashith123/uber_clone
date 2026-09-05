import { io, type Socket } from 'socket.io-client';
import { apiBase, getToken } from './api';

let socket: Socket | null = null;
let socketKey: string | null = null;

/** Lazily create one authenticated socket per session (re-created if token or server changes). */
export function getSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;
  const base = apiBase();
  const key = `${base}|${token}`;
  if (socket && socketKey === key) return socket;
  socket?.disconnect();
  socket = io(base || '/', { auth: { token }, transports: ['websocket', 'polling'] });
  socketKey = key;
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  socketKey = null;
}
