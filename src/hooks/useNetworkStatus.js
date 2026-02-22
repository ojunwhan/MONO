// src/hooks/useNetworkStatus.js — reactive online/offline + socket status
import { useState, useEffect, useCallback } from "react";
import socket from "../socket";

export default function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    const onConnect = () => setIsSocketConnected(true);
    const onDisconnect = () => setIsSocketConnected(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  // True only when both browser AND socket are connected
  const isConnected = isOnline && isSocketConnected;

  return { isOnline, isSocketConnected, isConnected };
}
