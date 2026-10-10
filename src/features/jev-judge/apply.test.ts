import assert from "node:assert/strict";
import {afterEach,mock,test} from "node:test";
import type {SupabaseClient} from "@supabase/supabase-js";
let legacyHandoffs=0;
mock.module("@/features/inbox/services/decision-engine.ts",{exports:{applyTransition:async()=>{legacyHandoffs++;}}});
mock.module("@/features/inbox/services/whatsapp-provider.ts",{exports:{loadWhatsAppSettings:async()=>({config:{jev_enabled:true}})}});
mock.module("@/features/jev-judge/judge.ts",{exports:{callJev:async()=>({model:"fixture",action:"handoff",actionConfidence:1,
  intentScore:0,autoReplyProbability:0,optOutProbability:0,inputTokens:1,outputTokens:1}),jevFailureCode:()=>"fixture_error"}});
mock.module("@/features/jev-judge/observe.ts",{exports:{trackJudgment:()=>{}}});
const {applyJevToBatch}=await import("./apply.ts");
const original=process.env.TYPESAFE_API_KEY;
afterEach(()=>{legacyHandoffs=0; if(original===undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY=original;});
const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{stage:"lead"},error:null})})}),
  insert:async()=>({error:null}),update:()=>({eq:async()=>({error:null})})})} as unknown as SupabaseClient;
const input={workspaceId:"fixture",conversationId:"fixture",contactId:"fixture",mergedText:"humano"};
test("Jev durable handoff delegates to the supplied server callback without the legacy notifier",async()=>{
  process.env.TYPESAFE_API_KEY="fixture-never-used";let quiet=0;
  const effect=await applyJevToBatch(db,input,{onHandoff:async()=>{quiet++;}});
  assert.equal(quiet,1);assert.equal(legacyHandoffs,0);assert.equal(effect.suppressReply,true);
});
test("legacy Jev keeps its handoff path when no durable callback is provided",async()=>{
  process.env.TYPESAFE_API_KEY="fixture-never-used";
  const effect=await applyJevToBatch(db,input);
  assert.equal(legacyHandoffs,1);assert.equal(effect.suppressReply,true);
});

test("durable Jev checkpoints handoff intent before a failed transition, without losing the cached verdict",async()=>{
  process.env.TYPESAFE_API_KEY="fixture-never-used";const order:string[]=[];
  const effect=await applyJevToBatch(db,input,{
    onVerdict:async(verdict)=>{assert.equal(verdict.handoffRequested,true);order.push("checkpoint");},
    onHandoff:async()=>{order.push("handoff");throw new Error("fixture-failure");},
  });
  assert.deepEqual(order,["checkpoint","handoff"]);assert.equal(effect.handoffRequested,true);
  assert.equal(effect.suppressReply,true);assert.equal(legacyHandoffs,0);
});
