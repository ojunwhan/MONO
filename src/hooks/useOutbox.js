// src/hooks/useOutbox.js — Offline message queue with auto-flush
import { useEffect, useRef, useCallback } from "react";
import socket from "../socket";
import { enqueueMessage, flushQueue, dequeueMessage } from "../db";

/**
 * Queues messages locally when offline.
 * Auto-flushes in order when socket reconnects.
 */
export default function useOutbox() {
  const flushingRef = useRef(false);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    if (!socket.connected) return;
    flushingRef.current = true;
    try {
      const queued = await flushQueue();
      for (const msg of queued) {
        socket.emit("send-message", {
          roomId: msg.roomId,
          message: { id: msg.msgId, text: msg.text },
          participantId: msg.participantId,
        });
        await dequeueMessage(msg.id);
      }
    } catch (e) {
      console.warn("[outbox] flush error:", e);
    } finally {
      flushingRef.current = false;
    }
  }, []);

  // Auto-flush on reconnect
  useEffect(() => {
    const onConnect = () => {
      setTimeout(flush, 500); // small delay for socket stabilization
    };
    socket.on("connect", onConnect);
    // Also flush on mount if already connected
    if (socket.connected) flush();
    return () => socket.off("connect", onConnect);
  }, [flush]);

  /**
   * Send or queue a message.
   * @returns {boolean} true if sent immediately, false if queued
   */
  const sendOrQueue = useCallback(async ({ roomId, msgId, text, participantId }) => {
    if (socket.connected) {
      socket.emit("send-message", {
        roomId,
        message: { id: msgId, text },
        participantId,
      });
      return true;
    }
    await enqueueMessage({ roomId, msgId, text, participantId });
    return false;
  }, []);

  return { sendOrQueue, flush };
}
