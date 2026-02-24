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

  const emitSendWithAck = useCallback(({ roomId, msgId, text, participantId }, timeoutMs = 3500) => {
    return new Promise((resolve) => {
      if (!socket.connected) {
        resolve(false);
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(false);
      }, timeoutMs);
      socket.emit(
        "send-message",
        {
          roomId,
          message: { id: msgId, text },
          participantId,
        },
        (ack) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(Boolean(ack?.ok));
        }
      );
    });
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    if (!socket.connected) return;
    flushingRef.current = true;
    try {
      const queued = await flushQueue();
      for (const msg of queued) {
        if (!msg?.participantId) {
          // Old malformed queue items cannot be sent safely.
          await dequeueMessage(msg.id);
          continue;
        }
        const ok = await emitSendWithAck({
          roomId: msg.roomId,
          msgId: msg.msgId,
          text: msg.text,
          participantId: msg.participantId,
        });
        if (ok) {
          await dequeueMessage(msg.id);
          continue;
        }
        // Keep order guarantee: stop flush and retry later.
        break;
      }
    } catch (e) {
      console.warn("[outbox] flush error:", e);
    } finally {
      flushingRef.current = false;
    }
  }, [emitSendWithAck]);

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
    if (socket.connected && participantId) {
      const ok = await emitSendWithAck({ roomId, msgId, text, participantId });
      if (ok) return true;
    }
    await enqueueMessage({ roomId, msgId, text, participantId });
    return false;
  }, [emitSendWithAck]);

  return { sendOrQueue, flush };
}
