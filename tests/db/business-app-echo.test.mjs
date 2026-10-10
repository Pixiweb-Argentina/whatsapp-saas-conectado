import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {createLegacyDatabase,applyOmnichannelMigrations} from "./database-harness.mjs";
import {runBusinessAppEchoChecks} from "./business-app-echo-checks.mjs";
const id=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
async function scalar(db,sql,args=[]) {return (await db.query(sql,args)).rows[0]?.result;}
async function prepareEchoFixture(db) {
  await db.exec(await readFile(new URL("./omnichannel-fixture.sql",import.meta.url),"utf8"));
  await db.query("update public.integrations set provider='kapso',config='{\"phone_number_id\":\"fixture-echo-account\"}' where id=$1",[id(11)]);
  await applyOmnichannelMigrations(db);
  await db.exec(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,legacy_integration_id)
    values('${id(51)}','${id(1)}','whatsapp','kapso','fixture-echo-account','ready','${id(11)}'),
    ('${id(52)}','${id(2)}','whatsapp','kapso','fixture-b','ready','${id(12)}');
    select private.backfill_whatsapp_workspace('${id(1)}','${id(51)}',100);
    select private.backfill_whatsapp_workspace('${id(2)}','${id(52)}',100);
    update public.contact_identities set verified_at=now()-interval '1 minute';
    update public.channel_connections set capabilities=jsonb_build_object('version',1,'grants',jsonb_build_array(
      jsonb_build_object('workspaceId',workspace_id,'connectionId',id,'capability','text','evidenceRef','fixture',
      'verifiedAt',now()-interval '1 minute','validUntil',now()+interval '1 hour')));`);
}
function echoContext(db,t) {
  const timestamp=new Date(Date.now()-60000).toISOString();
  const event={schemaVersion:1,workspaceId:id(1),connectionId:id(51),channel:"whatsapp",provider:"kapso",
    providerEventId:"wamid.fixture-1",kind:"message",externalActorId:"+15555550101",externalMessageId:"wamid.fixture-1",
    occurredAt:timestamp,receivedAt:timestamp,content:{type:"text",text:"fixture",rawType:"text"},mediaRefs:[],
    sourceContext:{channel:"whatsapp",sourceType:"direct_message"}};
  return {db,id,scalar,
    enqueue:async()=>{const e=await scalar(db,"select public.persist_channel_event($1,false) result",[event]);
      return scalar(db,"select public.enqueue_channel_job($1,$2,$3,$4,'echo-ai','ai',0,$5) result",
        [id(1),id(51),id(31),e,{operationId:id(61),channel:"whatsapp",recipient:"+15555550101",action:"text",body:"Do not send"}]);},
    claim:async()=> (await db.query("select * from public.claim_channel_job($1,$2)",[id(1),id(71)])).rows[0],
    begin:async(_,job)=>scalar(db,"select public.begin_channel_send($1,$2,$3,$4,$5,$6) result",
      [job.workspace_id,job.operation_id,job.lease_owner,job.fence,job.event_id,new Date(Date.now()+60000).toISOString()]),
    reject:async(_,run,code="23514")=>{await db.exec("SAVEPOINT denied");try{await assert.rejects(run,e=>e.code===code);}
      finally{await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied");}},
    isolated:async(name,run)=>t.test(name,async()=>{await db.exec("BEGIN");try{await run();}finally{await db.exec("ROLLBACK; RESET ROLE");}})};
}
test("F3 atomic Business App human echoes",async(t)=>{
  const {db}=await createLegacyDatabase();t.after(()=>db.close());await prepareEchoFixture(db);
  await runBusinessAppEchoChecks(echoContext(db,t));
});
