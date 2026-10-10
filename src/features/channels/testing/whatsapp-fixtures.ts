/** Synthetic fixtures based on the fork's parsers; not captured production payloads. */
export const YCLOUD_TEXT = {
  id: "event.synthetic-y1",
  type: "whatsapp.inbound_message.received",
  createTime: "2026-10-10T12:00:00.000Z",
  whatsappInboundMessage: {
    wamid: "wamid.synthetic-y1", from: "+15555550101", to: "+15555550100",
    type: "text", text: { body: "hola" }, customerProfile: { name: "Contacto de prueba" },
  },
};

export const KAPSO_TEXT = {
  phone_number_id: "synthetic-phone-id",
  message: {
    id: "wamid.synthetic-k1", from: "15555550101", timestamp: "1791633600",
    type: "text", text: { body: "hola" }, kapso: { direction: "inbound" },
  },
};

export const KAPSO_ECHO = {
  ...KAPSO_TEXT,
  message: { ...KAPSO_TEXT.message, kapso: { direction: "outbound", origin: "business_app" } },
};

export const YCLOUD_STATUS = {
  type: "whatsapp.message.updated",
  whatsappMessage: { id: "synthetic-delivery", wamid: "wamid.synthetic-y1", status: "delivered" },
};
