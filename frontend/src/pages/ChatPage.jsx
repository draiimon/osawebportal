import { useEffect, useMemo, useRef, useState } from "react";
import { createChatSocket } from "../lib/socket";

const tokenKey = "osa.react.auth.token";

export default function ChatPage() {
  const [status, setStatus] = useState("idle");
  const [conversationId, setConversationId] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const socketRef = useRef(null);

  const token = useMemo(() => localStorage.getItem(tokenKey) || "", []);

  useEffect(() => {
    const socket = createChatSocket(token);
    socketRef.current = socket;
    setStatus("connecting");

    socket.on("connect", () => setStatus("connected"));
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.on("chat:connected", (payload) => {
      setMessages((prev) => [...prev, { role: "system", content: JSON.stringify(payload) }]);
    });
    socket.on("chat:reply", (payload) => {
      setMessages((prev) => [...prev, { role: "assistant", content: payload.message || "" }]);
    });

    return () => socket.disconnect();
  }, [token]);

  function joinConversation() {
    if (!socketRef.current) return;
    socketRef.current.emit("chat:join", { conversation_id: conversationId || undefined }, (ack) => {
      if (ack?.ok) {
        setConversationId(ack.conversation_id);
        setMessages((prev) => [...prev, { role: "system", content: `Joined ${ack.conversation_id}` }]);
      } else {
        setMessages((prev) => [...prev, { role: "error", content: ack?.message || "Join failed" }]);
      }
    });
  }

  function sendMessage(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !conversationId || !socketRef.current) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    socketRef.current.emit("chat:message", { conversation_id: conversationId, message: text }, (ack) => {
      if (!ack?.ok) {
        setMessages((prev) => [...prev, { role: "error", content: ack?.message || "Send failed" }]);
      }
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-extrabold text-red-800">Realtime Chat (Socket.io)</h1>
      <p className="text-sm text-slate-700">Socket status: <span className="font-bold">{status}</span></p>

      <div className="flex gap-2">
        <input
          className="flex-1 border border-red-200 px-3 py-2"
          value={conversationId}
          onChange={(e) => setConversationId(e.target.value)}
          placeholder="conversation_id (leave blank for auto)"
        />
        <button className="border border-red-700 bg-red-700 px-4 py-2 text-sm font-bold text-white" type="button" onClick={joinConversation}>
          Join
        </button>
      </div>

      <div className="h-80 overflow-auto border border-red-200 bg-white p-3">
        {messages.map((item, idx) => (
          <p key={idx} className="mb-2 text-sm">
            <span className="font-bold uppercase text-red-700">{item.role}:</span> {item.content}
          </p>
        ))}
      </div>

      <form className="flex gap-2" onSubmit={sendMessage}>
        <input className="flex-1 border border-red-200 px-3 py-2" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type message..." />
        <button className="border border-red-700 bg-red-700 px-4 py-2 text-sm font-bold text-white" type="submit">
          Send
        </button>
      </form>
    </main>
  );
}
