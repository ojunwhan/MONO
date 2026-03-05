// src/push/index.js — Push notification client (VAPID / Web Push)
// Fetches public key from server, subscribes via Service Worker, syncs with server.

import socket from "../socket";

let vapidPublicKey = null;

/**
 * Check if push notifications are supported.
 */
export function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Request notification permission.
 * @returns {Promise<"granted"|"denied"|"default">}
 */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}

/**
 * Fetch VAPID public key from server.
 */
async function fetchVapidKey() {
  if (vapidPublicKey) return vapidPublicKey;
  try {
    const res = await fetch("/api/push/vapid-key");
    if (!res.ok) return null;
    const data = await res.json();
    vapidPublicKey = data.publicKey || null;
    return vapidPublicKey;
  } catch {
    return null;
  }
}

/**
 * Subscribe to push notifications.
 * Registers with Service Worker and sends subscription to server.
 * @param {string} userId - current user's ID
 * @returns {Promise<boolean>} true if subscribed successfully
 */
export async function subscribeToPush(userId) {
  if (!isPushSupported() || !userId) return false;

  const permission = await requestNotificationPermission();
  if (permission !== "granted") return false;

  const pubKey = await fetchVapidKey();
  if (!pubKey) {
    console.log("[push] No VAPID public key available");
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const deviceInfo = {
      ua: navigator.userAgent || "",
      platform: navigator.platform || "",
      language: navigator.language || "",
      createdAt: Date.now(),
    };
    
    // Check existing subscription
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pubKey),
      });
    }

    // Send subscription to server via both REST and socket
    socket.emit("push-subscribe", {
      userId,
      subscription: subscription.toJSON(),
      deviceInfo,
    });

    try {
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, subscription: subscription.toJSON(), deviceInfo }),
      });
    } catch {}

    console.log("[push] ✅ Subscribed successfully");
    return true;
  } catch (e) {
    console.warn("[push] subscribe error:", e);
    return false;
  }
}

/**
 * Unsubscribe from push notifications.
 * @param {string} userId
 */
export async function unsubscribeFromPush(userId) {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      
      socket.emit("push-unsubscribe", { userId, endpoint });
      try {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, endpoint }),
        });
      } catch {}
    }
  } catch (e) {
    console.warn("[push] unsubscribe error:", e);
  }
}

/**
 * Show a local notification (fallback when service worker unavailable).
 */
export function showLocalNotification(title, options = {}) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  // Respect global notification toggle
  try {
    if (localStorage.getItem("mono.notif.enabled") === "0") return;
  } catch {}
  try {
    new Notification(title, {
      body: options.body || "",
      tag: options.tag || "mono-msg",
      icon: "/icon-192.png",
      data: options.data || {},
    });
  } catch {}
}

// ── Utility ──
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default {
  isPushSupported,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  showLocalNotification,
};
