import { accountProofFixtureSql } from "./whatsapp-account-proof-fixture.mjs";
export const kapsoAccount = "155555507000001";
/** Explicitly fabricated accepted/delivered evidence, never a real provider verification or send. */
export function kapsoProofFixtureSql(id) {
  return accountProofFixtureSql(id).replaceAll("'ycloud'", "'kapso'").replaceAll("+15555550700", kapsoAccount)
    + `UPDATE private.channel_delivery_receipts SET recipient='+15555550101',provider_message_id=NULL
      WHERE workspace_id='${id(1)}' AND connection_id='${id(51)}';`;
}
