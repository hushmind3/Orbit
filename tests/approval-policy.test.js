import test from 'node:test';
import assert from 'node:assert/strict';
import {quickApproval,needsTaskApproval,isConsequentialLabel} from '../server/approval-policy.js';

const call=(name,args={})=>({name,args});
test('routine autonomous operations are not interrupted for each tap or browser step',async()=>{
 for(const name of ['open_app','android_open_app','android_swipe','android_back','android_type_text','remember','browser_fill','browser_press','browser_read','read_text_file']){
  assert.equal(quickApproval(call(name)),false,name);
 }
 assert.equal(await needsTaskApproval(call('browser_click',{text:'다음 페이지'})),false);
 assert.equal(quickApproval(call('write_text_file',{file:'x',overwrite:false})),false);
});
test('important irreversible commitments ask, even during an autonomous task',()=>{
 for(const name of ['start_customer_service_call','android_vision_screen','forget_personal_note'])assert.equal(quickApproval(call(name)),true);
 assert.equal(quickApproval(call('write_text_file',{overwrite:true})),true);
 assert.equal(quickApproval(call('browser_click',{text:'결제하기'})),true);
 assert.equal(quickApproval(call('browser_click',{text:'계정 삭제'})),true);
 assert.equal(quickApproval(call('browser_click',{selector:'#checkout-submit'})),true);
 assert.equal(quickApproval(call('browser_fill',{label:'비밀번호'})),true);
 assert.equal(isConsequentialLabel('확인','계약 해지'),true);
 assert.equal(isConsequentialLabel('확인','검색 화면'),false);
});
