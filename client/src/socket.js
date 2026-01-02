import { io } from 'socket.io-client';

export let socket = null;

export function connectSocket() {
  const token = localStorage.getItem('token');
  if (!token) {
    console.warn("No token found in localStorage");
    return;
  }

  // If socket already exists, disconnect first to avoid duplicates
  if (socket && socket.connected) {
    socket.disconnect();
  }

  socket = io('http://localhost:4000', {
    autoConnect: true,
    transports: ['websocket'],
    auth: { token },
  });

  socket.on('connect', () => console.log('Socket connected!', socket.id));
  socket.on('disconnect', () => console.log('Socket disconnected'));
  socket.on('connect_error', (err) => console.log('Connect error:', err.message));

  return socket;
}
