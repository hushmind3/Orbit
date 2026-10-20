import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {createJoinSession,sessionStatus,consumeJoinMessage,completeDemo,getOnboardingStats,isRegisteredWhatsApp,getJoinLink} from '../server/onboarding.js';
import {verifyWhatsApp,whatsappChallenge,parseWhatsApp} from '../server/inbox.js';

const db=path.join(os.tmpdir(),`orbit-onboarding-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
process.env.ORBIT_ONBOARDING_PATH=db;
process.env.ORBIT_REQUIRE_SMS='0';
process.env.WA_BUSINESS_NUMBER='15551234567';
process.env.WA_PHONE_NUMBER_ID='987654321';
process.env.WA_ACCESS_TOKEN='test_token';
process.env.WA_APP_SECRET='unit_test_app_secret';
process.env.WA_VERIFY_TOKEN='test_challenge';

test('WhatsApp QR session is not a registration until signed inbound token arrives',async()=>{
 try {
  const s=await createJoinSession();
  assert.equal(s.status,'awaiting_whatsapp');
  assert.match(s.link,/^https:\/\/wa\.me\/15551234567\?text=/);
  const pre=await sessionStatus(s.id);assert.equal(pre.verified,false);
  const code=new URL(s.link).searchParams.get('text');
  assert.match(code,/ORBIT-START [0-9a-f]{24}/);
  const empty=await consumeJoinMessage({from:'821012345678',text:'hello',messageId:'msg-0'});
  assert.equal(empty.consumed,false);
  const bad=await consumeJoinMessage({from:'821012345678',text:'ORBIT-START '+'0'.repeat(24),messageId:'msg-1'});
  assert.equal(bad.ok,false);
  assert.equal((await sessionStatus(s.id)).verified,false);
  const linked=await consumeJoinMessage({from:'821012345678',text:code,messageId:'msg-2'});
  assert.equal(linked.ok,true);
  assert.equal((await sessionStatus(s.id)).verified,true);
  assert.equal(await isRegisteredWhatsApp('821012345678'),true);
  assert.equal(await isRegisteredWhatsApp('821099999999'),false);
  assert.equal(await getJoinLink(s.id),null);
  const replay=await consumeJoinMessage({from:'821099999999',text:code,messageId:'msg-3'});
  assert.equal(replay.ok,false);
  assert.equal((await getOnboardingStats()).registered,1);
 }finally{await fs.rm(db,{force:true}).catch(()=>{});}
});

test('demo onboarding is clearly not a verified WhatsApp account',async()=>{
 const s=await createJoinSession({demo:true});
 assert.equal(s.status,'demo_waiting');assert.equal(s.link,null);
 await completeDemo(s.id);
 const d=await sessionStatus(s.id);
 assert.equal(d.verified,false);assert.equal(d.demo,true);
 assert.equal((await getOnboardingStats()).registered,0);
 await fs.rm(db,{force:true});
});

test('Meta webhook signature, challenge and message parse',()=>{
 const payload=JSON.stringify({entry:[{changes:[{field:'messages',value:{messages:[{type:'text',from:'821012345678',id:'wamid.X',text:{body:'ORBIT-START aabbcc'}}]}}]}]});
 const sig='sha256='+createHmac('sha256',process.env.WA_APP_SECRET).update(payload).digest('hex');
 assert.equal(verifyWhatsApp(payload,sig),true);assert.equal(verifyWhatsApp(payload,sig.slice(0,-2)+'00'),false);
 assert.equal(whatsappChallenge(new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':'test_challenge','hub.challenge':'challenge-token'})),'challenge-token');
 assert.equal(parseWhatsApp(JSON.parse(payload))[0].sender,'821012345678');
});
