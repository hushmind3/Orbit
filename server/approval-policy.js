/** Permission belongs to the user's job, not to every mouse click.
 * Inspect the actual target whenever the UI is accessible. These heuristics are
 * conservative for consequential actions; they do not claim to be perfect. */
import {inspectBrowserTarget} from './tools.js';
import {inspectMobileTarget} from './mobile.js';

const consequence=/(결제|구매|주문\s*(완료|확정|하기)|최종\s*주문|송금|이체|출금|해지\s*(신청|확정|완료)|계약\s*(체결|동의|서명)|동의\s*및|삭제|휴지통\s*비우기|영구\s*제거|계정\s*탈퇴|신청\s*(완료|제출)|확정\s*제출|전송|발송|제출|payment|checkout|place.?order|purchase|buy.?now|transfer|withdraw|delete|remove.?account|cancel.?subscription|unsubscribe|sign.?contract|send.?message|submit.?application|send.?email)/i;
const confirmation=/^(확인|예|네|동의|진행|완료|ok|yes|confirm|continue|next)$/i;
const sensitiveContext=/(결제|구매|주문|송금|이체|출금|해지|계약|삭제|영구|탈퇴|신청|발송|전송|payment|checkout|purchase|transfer|withdraw|delete|unsubscribe|contract)/i;
const credentials=/(비밀번호|암호|인증번호|보안코드|OTP|CVC|CVV|card.number|password|secret|credential|authorization|인증서)/i;

export function isConsequentialLabel(label='',context='') {
 const target=String(label||'').trim();
 return consequence.test(target)||(confirmation.test(target)&&sensitiveContext.test(context));
}

export function quickApproval(call) {
 const name=call?.name||'';
 const args=call?.args||{};
 if(['start_customer_service_call','android_vision_screen','forget_personal_note'].includes(name))return true;
 if(name==='write_text_file')return args.overwrite===true;
 if(name==='browser_fill')return credentials.test(String(args.label||'')+' '+String(args.selector||''));
 if(name==='browser_click')return isConsequentialLabel(String(args.text||'')+' '+String(args.selector||''));
 if(name==='browser_press')return false;
 // Ordinary navigation, creating a new file, memory, and routine input need no repeated consent.
 return false;
}

export async function needsTaskApproval(call) {
 if(quickApproval(call))return true;
 const args=call?.args||{};
 if(call.name==='android_tap') {
  try {const target=await inspectMobileTarget(args.x,args.y);return isConsequentialLabel(target.label,target.context);}
  catch {return false;} // Device errors will surface from the actual tool execution.
 }
 if(['browser_click','browser_press'].includes(call.name)){
  try {const target=await inspectBrowserTarget(call.name,args);return isConsequentialLabel(target.label,target.context);}
  catch {return false;} // No page: the normal tool will report a real error.
 }
 return false;
}
