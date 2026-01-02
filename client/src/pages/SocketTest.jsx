// client/src/pages/SocketTest.jsx
import { useEffect } from 'react';
import { io } from 'socket.io-client';

export default function SocketTest() {
  useEffect(() => {
    const s = io("http://localhost:4000", {
      transports: ["websocket"],
      auth: { token: localStorage.getItem("token") },
    });

    s.on("connect", () => console.log("connected!", s.id));
    s.on("connect_error", (err) => console.log("connect_error:", err));

    return () => s.disconnect();
  }, []);

  return <p>Check console for socket logs</p>;
}
