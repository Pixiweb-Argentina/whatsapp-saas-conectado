import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useNotificationPermission } from "./use-notification-permission";

test("notification permission renders identical SSR markup with or without a browser API", () => {
  function Probe() { return createElement("span", null, useNotificationPermission()); }
  const before = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Reflect.deleteProperty(globalThis, "window");
    const server = renderToString(createElement(Probe));
    Object.defineProperty(globalThis, "window", { configurable: true, value: { Notification: { permission: "default" } } });
    assert.equal(renderToString(createElement(Probe)), server);
    assert.equal(server, "<span>unsupported</span>");
  } finally {
    if (before) Object.defineProperty(globalThis, "window", before);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
