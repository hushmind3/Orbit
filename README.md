## 2026-10-20 전화 결과·중단 업무 추가 사전검사

- **전화 알림:** 발신 전 실제 소유자 수신처를 저장합니다. Twilio 종료 웹훅은 종료 사실을 먼저 디스크 알림 대기열에 저장하고 HTTP 200을 반환합니다. WhatsApp 실패 시 지수 지연을 두고 자동 재시도하며 재시작 시 재개합니다. 네트워크 시간 초과가 발생한 직후에는 중복 전송 가능성이 있습니다.
- **PC 전화:** PC에서 건 전화는 실제 소유자 WhatsApp 번호와 PC 대화방 모두에 결과를 남깁니다. 내부 PC 세션 ID를 외부 수신번호로 사용하지 않습니다.
- **미확인 실행:** 실행 중 서버가 종료됐다면 곧바로 반복하지 않습니다. 모델이 실제 읽기·조회 도구로 결과를 확인하고 실행 원장의 증거 ID를 reconcile_uncertain_execution으로 연결해 미확인 상태를 해소합니다. 증거가 없는 확정 주장은 거부됩니다.
- **검증:** 테스트에서 공급자 장애·알림 재시도·전화 종료 선도착·미확인 실행의 증거 연결을 확인했습니다. 실제 한국 고객센터 실전화/Meta/갤럭시는 미검증입니다.

# Orbit 0.7 — 모델 주도 자율 비서 · 작업 원장 · 확실한 보고

## 2026-10-20 사전 오류 점검

- 모델·서버·WhatsApp 연결 전에 재현 가능한 실행 결함을 수정했습니다. 검사 범위와 미검증 항목은 [`docs/PREFLIGHT_AUDIT.md`](docs/PREFLIGHT_AUDIT.md)에 기록했습니다.
- `npm test`: **36개 통과** (모의 모델·통신사·ADB 및 HTTP 통합 시나리오 포함).
- GitHub Actions가 `npm install`, `npm test`, `npm run build`를 자동 검사합니다. **실계정·실통화 성공 및 로컬 환경의 프론트 빌드까지 보장한다는 의미는 아닙니다.**


> **현재 단계:** GitHub 소스에서 실행 엔진을 통합하고 모의 모델/ADB/WhatsApp 테스트를 수행했습니다. Meta 실제 가입, 실제 통화, 갤럭시 실기기는 별도 검증이 필요합니다.

## 0.7에서 바뀐 원칙

- **사용자의 1번 지시가 업무 위임입니다.** 모델이 계획, 도구 선택, 화면 관찰, 오류 복구를 자율적으로 결정합니다. 기본 `autonomous` 모드에서는 앱 실행·터치·브라우저 클릭·파일 처리에 일일이 승인을 요구하지 않습니다.
- **사용자가 직접 결정해야 할 문제는 모델이 판단합니다.** `request_user_input`을 사용하면 WhatsApp에서 `답변 <코드> 내용`으로 자유로운 답변을 보내고 중단된 같은 업무가 계속됩니다. 사용자가 원하면 운영실에서 `review` 확인 모드로 바꿀 수 있습니다. 무엇이 중요한지는 명령의 목적, 사용자 지시, 실제 상황에 따라 모델이 판단합니다.
- **보고 역시 모델이 작성합니다.** `finish_task`로 최종 결과, `report_progress`로 필요할 때 중간 진행 상황을 작성합니다. 하네스는 도구 실행 전 의도·실행 후 결과·오류를 작업별 `.runtime/work-ledger/`에 기록하고, 이를 첨부해 `완료`와 `단순 메시지 발송`을 구분합니다.
- **모델이 완료라고 주장해도 직접 확인할 성공 기록이 하나도 없거나 미확인 실행이 있으면 완료로 단정하지 않습니다.** 실행 성공은 실제 사용자의 최종 목적 달성과 다를 수 있으며, 결제·해지·고객센터 협상의 확정 결과는 별도 확인이 필요합니다.
- **긴 업무:** 기본 실행 예산 120회(`ORBIT_MAX_STEPS`로 변경). 예산이 소진되면 작업을 `paused`로 보존하고 WhatsApp에서 `계속`을 보내 이어갈 수 있습니다. 서버가 중간에 종료되면 저장된 상태를 복구하며, 완료 여부가 불명확한 도구를 무조건 다시 실행하지 않습니다.
- **긴 대화:** 컨텍스트를 줄일 때 현재 업무의 실제 실행 결과와 사용자가 한 답변을 함께 요약합니다. 필요하면 모델이 `review_work_history`로 이전 실행 원장을 직접 조회할 수 있습니다.
- **업무별 상태:** `answered`, `reported`, `completed`, `partial`, `blocked`, `failed`, `paused`, `awaiting_input`, `report_pending`을 구분하고 WhatsApp 메시지의 `deliveredAt`과 혼동하지 않습니다. 외부 메시지 전송에 실패한 보고는 작업 원장에 보관하고 재전송을 시도합니다.
- **모델 공급자:** 기존 OpenAI 호환 API / Ollama 설정 유지. 운영실에서 자율 모드·모델·사용자 업무 지침을 직접 변경할 수 있습니다.

### 즉시 로컬에서 시험

`npm install` → `npm test` → Windows에서 `start-windows.bat` 또는 Mac에서 `start-mac.command` 실행 → `http://127.0.0.1:4786/`에서 모델과 작업 원칙 설정 → `실제 모델·도구 실행 테스트`.

WhatsApp 가입/회신은 Meta 계정·공개 HTTPS 웹훅이 필요하며, 한국 1588/1544 자동 발신은 아직 실전 보장되지 않습니다. 이용자 전체의 휴대폰을 제어하는 기능은 없으며 소유자 PC/ADB 장치만 연결됩니다. 본인에게만 허용한 기능을 여러 이용자에게 자동으로 개방하지 않습니다.

---

# Orbit 0.5 — WhatsApp 개인 AI 비서 · 실제 실행형

**WhatsApp의 Orbit 1:1 채팅창에서 모델과 대화하고, 소유자가 승인한 PC·갤럭시 조작, 고객센터 전화 발신을 처리하는 Node.js 서비스입니다.** 로그인·결제·고객센터 업무가 무조건 성공한다는 뜻이 아닙니다. 가입에서 실행까지 실제 연동을 갖추되 공급자 인증/통신망/각 사이트의 상태에 따라 완료 여부를 보고합니다.

## 사용자 경험

1. 공개 HTTPS 주소의 `/join`으로 접속하여 이름·전화번호(+82...)를 입력, Twilio Verify SMS 인증.
2. QR코드를 스캔하면 **Orbit 비즈니스 번호와의 WhatsApp 1:1 대화**가 열립니다. `ORBIT-START ...`로 미리 작성된 첫 메시지를 **보내야** 가입이 확정됩니다. 새로운 WhatsApp 그룹이나 계정을 자동 생성하는 것이 아닙니다.
3. WhatsApp에서 메시지를 보내면 실제 LLM으로 응답합니다. 모델이 지원하는 도구를 호출하면 결과를 받아 후속 조치를 진행합니다.
4. **서버 컴퓨터·갤럭시 조작은 소유자로 지정한 번호만** 할 수 있습니다. 일반 가입자는 자기 기억 저장/조회, 공개 웹페이지 읽기만 사용할 수 있고 소유자의 PC를 조작할 수 없습니다.
5. 삭제·기기 터치·파일 변경·발신 등은 WhatsApp으로 도구 인수와 일회용 코드가 전달되며 `승인 ABCD123456` 또는 `거절 ABCD123456`으로 결정합니다(20분 만료). 승인 없이는 실행하지 않습니다.
6. 처리 결과/모델 오류는 실제 상태대로 보냅니다. 통화 종료 시 확보한 상담 기록과 통신사 상태를 보고하며, `completed`라는 통신 상태는 해지·협상 목표 달성을 뜻하지 않습니다.

## Windows·Mac에서 실행

**요구사항:** Windows 11 / macOS, Node.js 22+, 인터넷 연결(공급자 API를 사용하는 경우). 설치 프로그램에서 Node.js를 먼저 설치합니다.

```sh
git clone https://github.com/hushmind3/Orbit.git
cd Orbit
npm install
npm test
npm start
```

또는 저장소 ZIP을 받은 후 Windows `start-windows.bat`, Mac `start-mac.command`를 실행하면 첫 실행에 `npm install`을 수행합니다. 브라우저가 열리지 않으면 아래 주소로 들어갑니다.

- 운영실 **`http://127.0.0.1:4786/`** — 모델·비즈니스 계정 설정, 실계정 연결 진단, 수신·승인 업무
- 가입 페이지 **`http://127.0.0.1:4786/join`** — 실제 연결은 Meta·Twilio 인증 설정이 있어야 가능
- 전화 협상 페이지 **`http://127.0.0.1:4786/phone`** — 협상 목표·발언 분석·실제 전화 발신 경로
- 외부 WhatsApp 메시지는 로컬 사이트를 직접 방문하지 않아도 웹훅을 통해 들어옵니다.

### 1. 범용 LLM 연결

운영실 `범용 AI 모델 연결`에서 공급자·API 기본 URL·모델명·키를 입력하고 **실계정 연결 진단**을 실행합니다. 지원 프로토콜:

| 모델 API | 예시 기본 URL | 비고 |
|---|---|---|
| OpenAI Chat Completions | `https://api.openai.com/v1` | 도구 호출 지원 모델 권장 |
| DeepSeek | `https://api.deepseek.com` | 도구 호출 모델 필요 |
| Gemini OpenAI 호환 | `https://generativelanguage.googleapis.com/v1beta/openai` | API 호환 수준은 모델별 확인 |
| OpenRouter | `https://openrouter.ai/api/v1` | 선택한 하위 모델의 도구 지원 필요 |
| Ollama 로컬 | `http://127.0.0.1:11434` | 도구 호출 지원 모델 사용 |

다른 공급자는 OpenAI 호환 엔드포인트가 제공되어야 연결됩니다. Claude 등 **공급자 고유 API 전체를 직접 지원한다고 주장하지 않습니다**. 안드로이드 스크린샷 해석은 OpenAI 호환 **이미지 입력 지원 모델**에만 작동하며, 실행 전에 명시적으로 승인해야 합니다.

### 2. Meta WhatsApp Business Cloud API 연결

필요한 것은 **소유자가 개설한 Meta 앱/WhatsApp Business 번호**입니다. Orbit가 Meta 사업자 계정을 자동 발급하거나 임의 번호를 만드는 것은 아닙니다.

1. [Meta 개발자 페이지](https://developers.facebook.com/apps/)에서 앱 생성 → WhatsApp 비즈니스 기능 연결, 사용할 비즈니스 번호 등록. Meta 정책·전화번호 인증·검토 요건을 따릅니다.
2. API Setup의 **Phone number ID**, 메시지 전송용 **Access token**(서비스 운영 시 적절한 영구 시스템 사용자 토큰), 해당 전화번호를 확인합니다.
3. 앱 설정에서 **App secret**을 확인하고 웹훅 인증용 **Verify token**을 직접 하나 만듭니다.
4. Orbit 운영실의 `WhatsApp / 전화 계정 연결`에서 `WA_BUSINESS_NUMBER`, `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`을 저장합니다.
5. HTTPS 터널/도메인을 Orbit의 4786 포트로 연결합니다. Meta 개발자 콘솔의 Callback URL을 **`https://설정한도메인/webhook/whatsapp`**으로, Verify token을 위에서 지정한 것과 동일하게 등록하고 **`messages`** 웹훅을 구독합니다.
6. 운영실 **연결 진단**에서 Meta 전화번호 조회 성공을 확인하고, `/join`에서 실제 자기 번호로 가입 및 WhatsApp 메시지 수신·응답을 시험합니다.

**필수:** `ORBIT_PUBLIC_URL`은 외부 HTTPS 주소여야 합니다. 로컬 `127.0.0.1`만으로는 Meta가 웹훅을 보낼 수 없습니다. 운영실 관리자 API를 공개 인터넷에 직접 노출하지 말고 리버스 프록시에서 가입·웹훅 URL만 공개하는 것이 바람직합니다. 본 서버의 관리자 API는 루프백/허가된 페어링 요청만 처리하지만, 그것만으로 다중 사용자 인터넷 서비스의 모든 보안 요건이 충족되지는 않습니다.

WhatsApp 메시지 전송에는 Meta의 **24시간 고객 서비스 창** 등 정책 제약이 적용됩니다. 장시간 후 사용자에게 먼저 메시지를 보내려면 승인된 템플릿이 필요할 수 있으며, 이 버전에는 템플릿 스케줄러를 구현하지 않았습니다.

### 3. 전화번호 SMS 인증

[Twilio 콘솔](https://console.twilio.com/)에서 `Account SID`, `Auth Token`을 확인하고 **Verify 서비스**를 만듭니다. `TWILIO_VERIFY_SERVICE_SID`를 운영실에 넣습니다. SMS 인증은 기본적으로 **필수**입니다. 계정이 없으면 실제 가입 기능을 활성화하지 않습니다. `ORBIT_REQUIRE_SMS=0`은 본인만 실험하는 개발 환경에서만 사용할 수 있는 선택적 우회 옵션입니다. 공개 배포에 사용하지 마세요.

### 4. 실제 전화 대행

Twilio Voice에서 발신 가능한 번호를 마련하고 `TWILIO_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `ORBIT_PUBLIC_URL`을 입력합니다. 통신사에서 한국 대상 발신을 허용하는지 확인합니다.

- `start_customer_service_call`은 승인 뒤 **실제 전화 API**를 호출합니다.
- 통화는 **초기 ARS 안내를 먼저 듣는 방식**으로 시작하며, 상대방이 번호 메뉴를 안내하면 모델 판단으로 DTMF 키를 재생합니다. 대기 안내·침묵 중에는 모델 추론 없이 듣기만 반복합니다.
- 상담원과 연결되면 통화 상대의 음성을 STT로 문자화하고 모델이 자연어 응답을 생성해 TTS로 읽습니다.
- 비용·새 약정·권리 포기 등은 임의로 수락하지 않게 지시했으며 조건 승인이 필요하다고 판단하면 합의하지 않고 통화를 마칩니다.
- 통화 세션/기록을 디스크에 유지하고 실제 종료 상태를 WhatsApp으로 통지합니다.

**중요한 제한:** 이것은 Twilio의 `<Gather>` 기반 턴제 음성통화입니다. 양방향 초저지연 음성 스트림, 끼어들기, 100% 안정적인 상담원/대기음 판별, 30분 대기 실전 성공률은 검증되지 않았습니다. **1588·1544 국내 대표번호는 일반 E.164 통화 API로 발신되지 않을 수 있으며 국내 통신망/SIP 공급자 연결이 아직 없습니다.** 실제 국가별 번호·통신사·요금·ARS 방식의 성공 여부는 발신 테스트로만 확정할 수 있습니다. 특정 민원 해결, 위약금 면제, 통화 성공을 보장하지 않습니다.

### 5. 갤럭시(Android) 직접 조작

스마트폰을 USB로 Mac/Windows PC에 연결하고 **개발자 옵션 → USB 디버깅 허용**을 완료합니다. `adb`가 설치되지 않았다면 Google 공식 도구를 내려받는 아래 명령을 1번 실행합니다.

```sh
npm run android:setup
```

모델 도구: `android_status`, `android_read_screen`(UI XML), `android_vision_screen`(승인 후 이미지 지원 LLM에 화면 전송), `android_open_app`, `android_tap`, `android_swipe`, `android_back`, `android_type_text`(ASCII), `android_dial`(다이얼러만), `android_duplicate_photos`(최대 200장 정확한 SHA-256 중복 후보, 삭제 없음). 연결된 **기기 1대만** 허용합니다. 기기 모델/앱/Android 버전에 따라 접근성 UI 확인이 어려울 수 있습니다. iPhone은 이 경로로 조작하지 않습니다.

중복 사진 탐지는 원본을 삭제하지 않습니다. 삼성 앱의 자동 삭제/결제/은행 송금처럼 돌이키기 어려운 동작은 별도 확인이 필요합니다. WhatsApp을 통해 보낸 명령이 서버 소유자의 USB 연결 갤럭시에 작동한다는 점을 인지하세요.

## 자동화 기능 현황 (오해 방지)

| 기능 | 현재 실제 코드 범위 |
|---|---|
| QR 가입·WhatsApp | SMS Verify + 서명 웹훅 + 번호 일치 검증 + 환영/대화 자동 응답 |
| 모델 | OpenAI 호환 Chat Completions 함수 호출, Ollama 함수 호출, 운영실 설정 |
| 가입자 분리 | 서로 다른 WhatsApp 번호별 대화·메모 저장, 호스트 PC 도구는 소유자만 |
| PC | 파일 탐색·읽기/쓰기, Chrome/Edge Playwright 브라우저 읽기/클릭/입력 |
| Android | ADB로 앱 실행·화면 조사·좌표 터치, 중복 사진 해시, 시각 모델(지원 API) |
| 전화 | Twilio 발신, ARS 음성/STT·DTMF, 대기 루프, 모델 협상, 실제 종료 상태 보고 |
| 장기 운영 | JSON 영속 기록·작업 승인·문서화된 설정, 1개 Node 프로세스 |
| 미완성 | 한국 1588·1544 실전 대리통화, 앱별 구매 결제 전 과정, iMessage, iOS 조작, 복잡한 멀티유저 PC 격리, 대규모 클러스터·워커 재시작 복구, 보장된 성과 협상 |

**실서비스 배포 전 추가 요구:** 개인정보 처리·보관·삭제 정책, 통화 및 녹취 관련 법률 준수, 계정 권한/오남용 방지, WhatsApp 템플릿, 관리자 다중 인증, 외부 HTTPS 배포, 운영 로그 백업·암호화, 공급자 비용 제한, 현지 통신사 검증, 모니터링. 현재는 1명 소유자의 셀프호스팅 파일럿을 목표로 했습니다.

## 테스트

```sh
npm test          # Node.js 도구·HTTP 웹훅·모의 Meta/Twilio/LLM 왕복 테스트
npm run build     # React/Vite 프론트 빌드 (npm install 후)
```

테스트는 **모의 Meta·Twilio·모델 API**로 로컬에서 검증합니다. 서비스 자격 증명이 없으므로 실SMS·실WhatsApp·실통화 성공률이나 실제 휴대폰 자동 조작까지 통과했다고 주장하지 않습니다. QR SVG는 `qrcode` npm 의존성이 설치돼 있어야 생성됩니다. 테스트 환경에서 모듈이 없으면 QR HTTP 503을 확인하고 나머지 왕복을 검사합니다.

운영실 `/api/admin/diagnostics`는 실제 사업자 자격 증명 검증 요청을 보내지만 SMS/통화 같은 유료 작업을 실행하지 않습니다. 실제 수신 웹훅·실제 전화 성공은 따로 확인해야 합니다.

## 개발·데이터

- `server/index.js`: HTTP, 가입/Meta/Twilio 라우팅
- `server/operator.js`: 범용 LLM 도구 실행·승인·소유자 권한·가입자별 작업 큐
- `server/mobile.js`: Android ADB·비전 모델
- `server/member-tools.js`: 가입자별 기억·공개 웹 읽기
- `server/onboarding.js`, `server/inbox.js`: 가입·메시지 상태·영속 기록
- `server/negotiation.js`: 통화 협상·ARS·Twilio 발신·통화 기록
- `server/diagnostics.js`: 외부 계정 설정 진단
- `public/admin.html`, `public/join.html`, `public/phone.html`: 빌드 없이 실행하는 운영 화면
- `.runtime/`: 로컬 실행 데이터와 개인키 (Git에서 제외, 백업/암호화는 운영자 책임)

이 프로젝트는 **현재 기능이 실제 연결되도록 구현**하는 데 초점을 맞춘 코드이며, 특정 서비스를 모방한 것일 뿐 Instinct/Dots/Muse 공식 제품이나 협력 프로젝트가 아닙니다.
