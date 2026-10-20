# Orbit 0.6 — 실제 가입·WhatsApp·기기 조작·전화 실험

## Orbit 0.6 — 업무 단위 자율 실행

반복적인 앱 실행·터치·스와이프·웹 클릭·입력·메모는 **업무 지시를 받으면 자동으로 연속 실행**합니다. 실제 기기 화면과 웹페이지를 조작 후 재확인하고, 기본 40단계(설정 가능 최대 60단계)까지 이어갑니다. 중요한 구매·계약·삭제·파일 덮어쓰기·전화 발신은 별도 승인 대상으로 구분합니다. UI 문구에 의존한 위험 판단은 완벽하지 않으므로 실제 기기·금융 서비스에 사용하기 전에 별도 시험이 필요합니다. 자세한 내용: [자율 실행 정책](docs/AUTONOMY.md).

> **실행 수준:** 실제 Meta/Twilio 계정이 있는 환경에서 연결하도록 구현했으나, 실제 사업자 계정/한국 대표번호 전화 실전 검증은 아직 안 됐습니다. QR→서명된 메시지→가입→모델 응답→발송의 HTTP 흐름은 **모의 통신 사업자**로 검증했습니다. 외부 계정·통신망·서비스별 제약 때문에 모든 업무 완료를 보장하지 않습니다.

## 이번 버전에서 실제 바뀐 점

- **가입:** Meta WhatsApp Business 번호 + Twilio Verify SMS 인증이 **기본 필수**입니다. 이름·이메일(선택)과 전화번호를 받고, SMS 인증 뒤 `wa.me` QR로 Orbit 비즈니스 번호의 **1:1 채팅창**을 엽니다. 사용자 본인이 미리 입력된 코드를 보내야 가입을 확정합니다. Orbit가 WhatsApp 그룹/계정을 직접 만들지는 않습니다.
- **대화:** 가입 완료한 모든 WhatsApp 사용자의 메시지는 연결한 LLM이 자동으로 처리·회신합니다. 사용자별 대화와 기억이 구분됩니다. **일반 가입자는 자신의 메모/공개 웹 읽기만 사용 가능하며 서버 PC/갤럭시/전화 사용 권한은 없습니다.** PC·전화 권한은 운영실에서 지정한 소유자 WhatsApp 번호에 한정됩니다.
- **PC/기기 조작:** Playwright 웹 탐색·파일 읽기/쓰기, Android ADB 화면 요소 읽기·앱 실행·터치·스와이프·영문 입력·다이얼러·정확한 중복 사진 검사(최대 200장, 삭제 안 함). 화면 인식이 어려울 때는 승인 후 이미지를 비전 지원 모델로 전송해 해석할 수 있습니다. Android 공식 도구: `npm run android:setup`(Google 공식 도구 다운로드, USB 디버깅 직접 허용 필요).
- **전화:** Twilio Voice를 통한 실제 발신 코드, 키패드 ARS, 음성 대화, 조용한 상담원 대기 루프, 모델의 협상 대응, 저장된 통화 내역/종료 통보. **한국 1588/1544 발신은 현재 보장되지 않고, Twilio `<Gather>` 턴제 방식으로 중간에 끼어드는 자연스러운 양방향 통화와 장시간 통화 실전 검증은 없습니다.** 국내 통신망/SIP 연동은 아직 미구현입니다.
- **모델:** OpenAI-compatible Chat Completions 도구 호출과 Ollama를 지원합니다. OpenAI, DeepSeek, Gemini OpenAI 호환, OpenRouter URL 프리셋을 제공합니다. **Claude 네이티브 API까지 완전 지원하지는 않습니다.** 모델이 도구 호출을 지원해야 자율 실행을 할 수 있습니다.
- **진단:** 운영실 **실계정 연결 진단**에서 Meta 전화번호, Twilio 계정, Twilio Verify 서비스, 모델 채팅 응답을 실제 API로 조회합니다. 이 진단은 유료 SMS/전화 발신이나 웹훅 수신 성공을 대신하지 않습니다.
- **검증:** `npm test` **20개 통과**(가짜 Meta/Twilio/LLM을 사용한 HTTP 왕복 포함). 실제 Meta 가입·SMS·전화 연결, 갤럭시 실기기, QR 라이브러리 설치 후의 SVG 출력은 현재 실행 환경에서 검증하지 못했습니다.

## 준비 순서 (개인용 파일럿)

1. [Node.js 22+](https://nodejs.org/) 설치 → GitHub 소스를 내려받아 `start-windows.bat` 또는 `start-mac.command` 실행. 최초 실행 때 npm 의존성을 설치합니다.
2. `http://127.0.0.1:4786` 운영실에서 범용 LLM 주소·모델·키·소유자 WhatsApp 전화번호를 저장합니다.
3. [Meta 개발자 콘솔](https://developers.facebook.com/apps/)에서 WhatsApp Business 앱과 번호를 만들고 번호 ID·토큰·앱 시크릿을 받습니다. 운영실에 입력합니다.
4. [Twilio 콘솔](https://console.twilio.com/)에서 SMS Verify 서비스와 Voice 발신번호를 준비하고 키를 운영실에 입력합니다. **개발자가 아닌 일반 가입자의 SMS 검증은 기본적으로 생략되지 않습니다.** `ORBIT_REQUIRE_SMS=0`은 개발자 개인 시험에서만 허용하는 우회 옵션입니다.
5. Node 서버에 공개 HTTPS 주소 또는 HTTPS 터널을 연결하고 `ORBIT_PUBLIC_URL`을 해당 주소로 설정합니다. Meta 앱에 **`https://공개주소/webhook/whatsapp`**를 등록하고 `messages` 이벤트를 구독합니다. 외부에는 가입·웹훅만 공개하고 운영실/`/api/`는 공개하지 않는 게 좋습니다.
6. 운영실 **실계정 연결 진단** 후 공개주소의 `/join`으로 전화번호 SMS 인증 → QR 스캔 → WhatsApp 첫 코드 메시지 발송 → Orbit 환영 메시지 수신을 실험합니다.

**주의:** WhatsApp은 사용자가 마지막으로 메시지를 보낸 이후 24시간 고객 서비스 창 등의 정책이 있습니다. 이 버전에는 승인된 템플릿을 이용한 장기 알림 발송과 다중 인스턴스 분산 실행은 구현하지 않았습니다. 카드 결제·로그인·가입 상태에 따른 전문서비스 작업까지 모두 자동으로 성공하는 것은 아닙니다. 관리자 데이터에는 대화·모델 API 키가 로컬 파일로 저장되므로 공개 서버 운영 시 추가 인증·개인정보 보호·백업·비용 통제가 필요합니다.

---

# Orbit — WhatsApp-first AI operator · Windows / macOS

Orbit은 **WhatsApp으로 메시지를 받아, 사용자가 지정한 범용 LLM과 로컬 PC 도구를 실행하는 개인 AI 비서**입니다. 서버는 Node.js 22+, 화면은 정적 관리자·가입 UI(기존 Vite+React 코드는 유지)입니다. 개인이 설치해서 시험할 수 있도록 단일 포트 `4786`으로 실행합니다.

## 1. 설치 · 화면

```bash
npm install
npm test
npm start
```

- 운영실/모델/전화 계정 설정: **http://127.0.0.1:4786/**
- 고객용 휴대폰 인증 + WhatsApp QR: **http://127.0.0.1:4786/join**
- 전화 협상 및 갤럭시 실험: **http://127.0.0.1:4786/phone**
- Windows: `start-windows.bat`, macOS: `bash start-mac.command` 실행. 첫 실행에 `npm install`을 수행합니다.
- GitHub에서 소스를 받으면 서버가 자동으로 외부 서비스에 가입하거나 앱을 배포하는 것은 아닙니다. **실제 연결은 사업자 계정이 필요합니다.**

## 2. 설정: 운영실에서 값 입력하기

운영실의 **범용 AI 모델 연결**에 다음을 입력합니다.

- 공급자: OpenAI 호환 API (OpenAI/DeepSeek 및 호환 엔드포인트) 또는 Ollama
- 모델 API 기본 주소: OpenAI 호환은 `https://.../v1`, Ollama는 `http://127.0.0.1:11434`
- 모델명과 (필요하면) API 키
- **내 WhatsApp 번호**: 국가번호 포함 숫자, 예 `821012345678`. 등록된 소유자 계정에 한해서 로컬 PC 도구 실행을 허용합니다.

외부 서버에 키를 직접 입력할 수도 있습니다 (`.env.example` 참고). 운영실에서 입력한 구성은 `.runtime/config.json` 및 `.runtime/connectors.json`에 저장되고, 서버의 프로세스 사용자만 읽도록 권한이 설정됩니다. **키를 GitHub에 커밋하지 마세요.** 운영실은 외부 인터넷에 직접 공개하지 말고, 인증된 로컬 관리망에서만 접근시키세요.

## 3. WhatsApp QR 가입 + SMS 번호 인증

WhatsApp 고객과 연결하려면 **Meta WhatsApp Business Platform / Cloud API** 개발자 앱 및 비즈니스 발신번호가 있어야 합니다.

운영실 **WhatsApp / 전화 계정 연결**에 아래 Meta 값을 설정합니다.

- `WA_BUSINESS_NUMBER`: QR에 연결할 WhatsApp 비즈니스 전화번호(국가번호, 숫자)
- `WA_PHONE_NUMBER_ID`: Meta Cloud API phone-number ID
- `WA_ACCESS_TOKEN`: 유효한 접근 토큰. 운영 시 적절한 장기 토큰 사용
- `WA_APP_SECRET`: 웹훅 HMAC 검증용 앱 시크릿
- `WA_VERIFY_TOKEN`: Meta 웹훅 챌린지에 사용하는 임의 토큰
- `WA_GRAPH_VERSION`: 기본 `v26.0`
- Meta 앱에서 **`https://YOUR_PUBLIC_HTTPS_HOST/webhook/whatsapp`** 주소를 설정하고 `messages` 웹훅 이벤트에 구독해야 합니다. 공개 HTTPS/방화벽/Meta 개발자 자격은 별도로 준비해야 합니다. **운영실 `/` 또는 `/api/*`는 공개하지 마세요.** 공개 리버스 프록시에서는 `/webhook/whatsapp`, `/join`, `/onboarding/*`만 허용할 것을 권장합니다.

추가로 전화번호 SMS 인증을 사용하려면 Twilio Verify Service를 연결합니다.

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` 입력
- SMS 인증이 설정되면: **전화번호 입력 → Twilio SMS 코드 검증 → QR 생성 → WhatsApp에서 일회용 코드 메시지 전송 → 서명 검증 웹훅 수신 → 실제 가입**
- 인증된 SMS 번호와 WhatsApp 송신 번호가 정확히 일치해야 가입됩니다. WhatsApp QR 코드 15분 만료, SMS 재전송 간격/횟수 제한.
- SMS Verify를 연결하지 않으면 **일반 공개 가입은 활성화되지 않습니다.** `ORBIT_REQUIRE_SMS=0` 개발 환경에서만 WhatsApp 자체 발신번호 확인 방식으로 시험할 수 있습니다.
- 계정 키가 없으면 QR 실가입을 성공했다고 표시하지 않습니다. Meta 시험 번호는 시험 허용 사용자 등 공급자 측 제한이 적용됩니다.

## 4. WhatsApp으로 실제 작업하기

1. `/join`에서 QR 인증을 완료하고 사용자 본인이 WhatsApp에서 Orbit에게 메시지를 보냅니다.
2. Orbit은 Meta 서명 검증과 가입된 발신번호 검사를 거친 메시지만 수신합니다. 소유자 번호가 아니면 PC 도구 실행은 허용하지 않습니다.
3. **가입한 사용자**의 요청은 실제 모델의 function/tool calling으로 들어갑니다. 소유자는 PC와 휴대폰 도구를 추가로 사용할 수 있습니다. 조회·검색 등의 결과를 받아 다음 단계를 판단합니다.
4. 브라우저 클릭/입력/키보드/파일 저장·메모/앱 실행/실제 전화 발신 등은 WhatsApp에서 **`승인 <코드>`** 메시지를 전송하기 전에는 실행되지 않습니다. **`거절 <코드>`**로 취소할 수 있고, 승인 요청은 20분 후 만료됩니다. 운영실에서도 승인/거절할 수 있습니다.
5. 승인 후 실행 결과가 다시 모델에 전달되고, 이어 작업한 뒤 WhatsApp 대화방에 실제 결과가 전송됩니다. 승인·도구 실행·모델 응답은 서버에 기록됩니다.
6. 같은 운영실에서 **`실제 모델·도구 실행 테스트`** 기능으로 WhatsApp 없이도 모델을 호출하고 승인-실행 흐름을 시험할 수 있습니다.

**실행 대상은 서버의 컴퓨터입니다.** 일반 WhatsApp 이용자의 휴대전화 사진·앱을 직접 조작할 수 있는 것은 아닙니다. 그런 기능은 사용자 기기에 별도 클라이언트/디바이스 연결이 필요합니다. 현재 파일 도구는 Desktop/Documents/Downloads 폴더만 접근하며, 브라우저는 Chrome 또는 Edge를 요구합니다.

## 5. 전화 API · 실제 고객센터 상담

- Twilio Programmable Voice: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `ORBIT_PUBLIC_URL` (`https://...`) 설정
- 발신 도구: `start_customer_service_call`. 사용자 WhatsApp 승인 후 Twilio Calls REST API로 발신을 요청합니다. 업무 목표/금지 조건과 LLM 협상 응답을 통화별로 보관합니다.
- Twilio 웹훅 서명 검증: `/twilio/voice/:id`, `/twilio/status/:id`, 공개 HTTPS URL 필요.
- **국내 1588/1544 고객센터가 Twilio에서 연결되는 것은 보장되지 않습니다.** 통화 음질/ARS/수십 분 대기·상담원 자동 감지·양방향 실시간 오디오·재연결도 실통화 검증을 거치지 않았습니다.
- 갤럭시 다이얼러 열기는 **자동 AI 통화가 아니라 휴대폰 전화 앱에 번호를 채우는 기능**입니다.

## 6. 테스트와 실제 검증의 차이

- `npm test`는 모의 LLM, 모의 Twilio Verify, 가입 상태 및 승인 후 실행을 검사합니다.
- **실제 WhatsApp Business 계정, 실제 SMS 수신, 한국 1588 고객센터 발신, 사용자의 갤럭시 제어는 현재 검증하지 못했습니다.** 외부 계정 키 없이 완전한 실서비스를 검증하거나 운영할 수는 없습니다.
- WhatsApp 앱에 Orbit 대화가 나타나는 것은 실제 비즈니스 번호로 메시지를 보낸 뒤 Meta 웹훅이 등록을 완료한 경우에만 해당합니다.
- 복잡한 통화의 협상 성공률은 모델 성능과 전화 인프라에 따라 다릅니다. 모델이 사용자의 이익을 항상 극대화한다고 보장할 수 없습니다.

## 7. 범위 / 실험 대상

기존 `/phone`의 상담원 발언 입력 → 모델 응답, Twilio 통화 실험, ADB 갤럭시 전화 앱 열기, PC 중복 이미지 검색은 보존됩니다. 구매 자동 결제/앱스토어 가입/임의의 휴대전화 제어/다중 사용자별 독립된 PC 브리지/동시 다중 전화 상담은 아직 서비스화되지 않았습니다. 고객별 고립 작업 공간과 감사 로그를 완성하기 전에는 다중 사용자 상용 서비스 운영을 권장하지 않습니다.