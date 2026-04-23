import { io } from "socket.io-client";

export function createChatSocket(token) {
  return io(import.meta.env.VITE_SOCKET_BASE_URL || "/ws/chat", {
    transports: ["websocket"],
    auth: token ? { token } : {},
  });
}
