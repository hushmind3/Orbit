# Orbit — FastAPI 관리 시스템 + Node 실행 엔진 + Tailwind 콘솔

**Orbit의 사용자 대화 채널은 WhatsApp입니다.** PC 웹 화면은 가입자·업무·모델·연결 상태·전화 내역·실행 기록을 보는 **운영 관리 콘솔**입니다. PC 채팅방을 기본 사용자 인터페이스로 사용하지 않습니다.

## 역할 분리

| 계층 | 기술 | 역할 |
|---|---|---|
| 기존 관리 서버 | **Python FastAPI** | 운영 콘솔·관리 인증 전용 (외부 가입 업무 없음) |
| 프론트 | **React / TypeScript / Tailwind CSS 4 / Vite** | 공개 가입 홈페이지와 비공개 관리 콘솔을 별도 빌드 |
| 실행 엔진 | **Node.js 22+** | Meta WhatsApp 수신·발신, Twilio, LLM 도구 호출, PC/Android 작업, 상태/알림 복구 |
| 에이전트 판단 | 사용자가 연결한 **Ollama / OpenAI 호환 모델** | 계획·행동 선택·검증·질문·진행 및 최종 보고 |

사용자의 기존 FastAPI 서버를 대체할 필요가 없습니다. `APIRouter`를 붙이는 것이 공식 통합 방식입니다. Node는 내부 `127.0.0.1` 바인딩으로만 실행하며, 외부 공개는 FastAPI/기존 프록시에서 관리합니다. 기존 FastAPI 프로젝트의 경로 구조나 인증 미들웨어를 임의 변경하지 않습니다.

## 누구나 외부에서 셀프 가입, 관리자는 개입하지 않음

**관리자는 고객 전화번호를 일일이 인증·승인하지 않습니다.** 이용자는 공개 HTTPS 가입 홈페이지에서 자기 전화번호를 SMS로 확인하고 WhatsApp QR/딥링크 연결 메시지를 처음 1회 전송합니다. 번호가 일치하면 Node 가입 백엔드가 즉시 자동 등록합니다. 이후 등록된 번호로 WhatsApp에서 일을 지시하면 되고 PC 관리 콘솔에 접속하거나 매번 인증할 필요가 없습니다.

가입자는 관리 콘솔을 사용할 수 없습니다. 회원 가입 승인 업무나 매번 수동으로 열어야 할 작업 큐도 없습니다. 운영 콘솔의 모델 설정·장애 확인·기록 조회는 관리자만 필요할 때 사용하는 기능입니다.

### 공개 가입용 FastAPI 앱 (외부 웹사이트)

```python
from fastapi import FastAPI
from orbit_control import create_public_router
public_app = FastAPI()
public_app.include_router(create_public_router(worker_url="http://127.0.0.1:4786"))
```

공개 경로는 `https://가입도메인/join`, `/onboarding/*`, Meta `/webhook/whatsapp`, Twilio `/twilio/*`입니다. 운영자용 `/api/admin/*`이나 관리 로그인은 이 공개 라우터에 없습니다. 외부에서 접근 가능한 도메인/프로세스를 별도로 배포하며 HTTPS 프록시가 필요합니다. Node worker는 외부에 직접 노출하지 않습니다.

## 기존 FastAPI 앱에 붙이는 방법

```python
from fastapi import FastAPI
from orbit_control import create_router

app = FastAPI()  # 기존 앱이 있다면 그 app을 사용
app.include_router(create_router(worker_url="http://127.0.0.1:4786", prefix="/orbit"), prefix="/orbit")
```

앱 프로젝트의 Python import 경로에 Orbit 저장소를 포함해야 합니다. 같은 Python 환경에 `pip install -r requirements-control.txt`를 설치하세요.

```bash
# 기존 Node 22+ 사용: 실행 엔진만 로컬로 시작
npm install
npm run build
npm run server

# Python 패키지가 별도 설치돼 있지 않은 경우에만
python -m pip install -r requirements-control.txt

# 기존 FastAPI 앱에 APIRouter를 등록하고 기존 방식으로 서버 실행
# 독립적으로 확인할 때만 아래를 별도 터미널에서 실행
python -m orbit_control
```

- FastAPI 관리: 기존 앱에 붙였다면 **`/orbit/`**. 독립 실행 기본 주소: `http://127.0.0.1:8766/orbit/`.
- 공개 가입 웹사이트: **`https://가입도메인/join`**. 독립된 React·Tailwind 번들입니다.
- Meta 공개 웹훅: **`https://가입도메인/webhook/whatsapp`**.
- Twilio 공개 웹훅: **`https://가입도메인/twilio/...`**.
- 내부 Node 실행기: `http://127.0.0.1:4786` (직접 공개 금지).
- 관리 웹 API: **`/orbit/api/...`** (FastAPI 관리 인증 뒤에만 접근).

`ORBIT_PUBLIC_URL`은 **`https://가입도메인`**로 설정해야 합니다. Node가 Twilio 서명을 검증할 때 외부에서 사용한 URL 경로가 포함돼야 하기 때문입니다. Meta 웹훅 등록에도 공개 가입 도메인의 경로를 사용해야 합니다. Python 게이트웨이는 수신 본문을 재직렬화하지 않고 전달합니다.

### 원격 관리자 인증

외부 도메인에서 운영 콘솔을 열려면 **`ORBIT_ADMIN_TOKEN`** 환경 변수를 강력한 임의 암호로 설정하세요. 로그인하면 12시간 만료 HTTP-only 세션 쿠키가 발급됩니다. 비밀번호는 브라우저 로컬 저장소에 보관하지 않습니다. 로컬 루프백으로만 접속한 경우에는 별도 로그인 없이 운영할 수 있습니다. 기존 FastAPI 인증 정책이 더 엄격하다면 해당 정책을 추가로 적용하세요. `/orbit/api/*`는 절대로 무인증으로 프록시 공개하지 마세요.

`ORBIT_CONTROL_PORT`, `ORBIT_PORT`, `ORBIT_WORKER_URL` 등의 값은 사용자의 포트 환경에 맞게 바꿀 수 있습니다. FastAPI 접두사 `/orbit`도 `create_router`의 `prefix`와 `include_router`의 경로를 동시에 바꿔 조정할 수 있습니다.

## 운영 흐름

1. 운영 콘솔의 **모델·에이전트**에서 모델 URL·모델명·소유자 WhatsApp 번호·사용자 업무 원칙을 설정합니다.
2. **연결·진단**에서 Meta WhatsApp 및 Twilio 설정·API 진단을 수행합니다.
3. 사용자는 외부 공개 홈페이지 `/join`에서 자기 번호로 SMS·QR 인증해 **자동 등록**하며, 관리자의 개별 승인은 없습니다.
4. Node 에이전트가 도구를 사용하고 모델이 다음 행동을 결정하며, 작업 원장/체크포인트에 기록합니다.
5. WhatsApp에 중간/최종 보고를 보냅니다. 관리자는 PC 운영 콘솔에서 업무, 오류, 보고 상태, 실제 실행 기록을 확인합니다.

관리 화면은 **모델에게 '버튼을 누르라'고 고정 절차를 강요하지 않습니다.** 도구의 계약(함수 이름/매개변수), 네트워크 설정값, 외부 API 규격은 코드로 정의되어 있지만, 업무별 계획·행동 순서·진행/최종 보고는 AI 모델이 판단합니다. 실행 기록이 곧 목표 달성 증명은 아니며, 통화 종료는 해지/환불 성공과 다릅니다.

## 검증

GitHub CI: Node 실행 테스트 → Node 구문 검사 → Python FastAPI 라우터 테스트 → TypeScript 타입 검사 및 Tailwind/Vite 프로덕션 빌드.

```bash
npm test
python -m unittest discover -s tests_python -p 'test_fastapi.py' -v
npm run build
```

**아직 실계정·실기기 검증은 별개입니다.** 실제 Meta Business 계정, Twilio 통화, Android ADB, Windows/기존 FastAPI 배포 환경, 국내 1588/1544 발신 제한은 로컬 모의 검사가 대신하지 않습니다. 기능이 없는 통신망·사업자 서비스까지 된다고 표시하지 않습니다.

## 규모의 한계 — 중요한 사전 조건

**자동 가입된다는 것과 수십만~수백만 명의 동시 이용을 감당한다는 것은 다릅니다.** 현재 가입자·업무 상태는 로컬 JSON 파일을 쓰고 있어 대규모 SaaS용 저장 구조가 아닙니다. 실제 다중 사용자 상용 서비스에 앞서 PostgreSQL 등 트랜잭션 DB, 작업 큐/워커 분리, 공유 속도 제한, 백업·복구와 부하 테스트가 필요합니다. 이 기반 없이 규모를 지원한다고 주장하지 않습니다.
