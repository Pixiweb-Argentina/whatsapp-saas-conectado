import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationItem } from "../../../src/features/inbox/components/conversation-item.tsx";
import type { ConversationWithContact } from "../../../src/features/inbox/types/index.ts";

const fixture: ConversationWithContact = {
  id: "fixture-conversation", workspace_id: "fixture-workspace", contact_id: "fixture-contact",
  channel: "instagram", state: "paused", ai_enabled: false, assigned_to: null,
  last_message_at: null, window_expires_at: null, unread_count: 0,
  created_at: "2026-10-10T12:00:00Z", updated_at: "2026-10-10T12:00:00Z",
  contact: {
    id: "fixture-contact", workspace_id: "fixture-workspace", phone: null, name: null, email: null,
    stage: "new", tags: [], opt_in: false,
    created_at: "2026-10-10T12:00:00Z", updated_at: "2026-10-10T12:00:00Z",
  },
  last_message: { body: "Consulta de prueba", direction: "in", created_at: "2026-10-10T12:00:00Z" },
};
process.stdout.write(renderToStaticMarkup(createElement(ConversationItem, {
  conversation: fixture, isActive: false, onClick: () => {},
})));
