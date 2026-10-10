"use client";

import { useSyncExternalStore } from "react";

type NotificationSupport = "unsupported" | NotificationPermission;
const PERMISSION_CHANGED = "inbox-notification-permission";

function currentPermission(): NotificationSupport {
  return typeof window !== "undefined" && "Notification" in window
    ? Notification.permission : "unsupported";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(PERMISSION_CHANGED, onChange);
  window.addEventListener("focus", onChange);
  return () => {
    window.removeEventListener(PERMISSION_CHANGED, onChange);
    window.removeEventListener("focus", onChange);
  };
}

/** Hydration starts with the same snapshot as SSR; no permission prompt on mount. */
export function useNotificationPermission(): NotificationSupport {
  return useSyncExternalStore(subscribe, currentPermission, () => "unsupported");
}

/** Invoked only by an explicit operator action. */
export async function requestNotificationPermission(): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  await Notification.requestPermission();
  window.dispatchEvent(new Event(PERMISSION_CHANGED));
}
