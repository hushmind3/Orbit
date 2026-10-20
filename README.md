# Orbit — FastAPI 관리 시스템 + Node 실행 엔진 + Tailwind 콘솔

**Orbit의 사용자 대화 채널은 WhatsApp입니다.** PC 웹 화면은 가입자·업무·모델·연결 상태·전화 내역·실행 기록을 보는 **운영 관리 콘솔**입니다. PC 채팅방을 기본 사용자 인터페이스로 사용하지 않습니다.

## 역할 분리

| 계층 | 기술 | 역할 |
|---|---|---|
| 기존 관리 서버 | **Python FastAPI** | 운영 콘솔, 관리 인증, 공개 가입/웹훅 라우팅 |
| 프론트 | **React / TypeScript / Tailwind CSS 4 / Vite** | 업무·가입자·에이전트·모델·연결·전화·기록 관리 |
| 실행 엔진 | **Node.js 22+** | Meta WhatsApp 수신·발신, Twilio, LLM 도구 호출, PC/Android 작업, 상태/알림 복구 |
| 에이전트 판단 | 사용자가 연결한 **Ollama / OpenAI 호환 모델** | 계획·행동 선택·검증·질문·진행 및 최종 보고 |

사용자의 기존 FastAPI 서버를 대체할 필요가 없습니다. `APIRouter`를 붙이는 것이 공식 통합 방식입니다. Node는 내부 `127.0.0.1` 바인딩으로만 실행하며, 외부 공개는 FastAPI/기존 프록시에서 관리합니다. 기존 FastAPI 프로젝트의 경로 구조나 인증 미들웨어를 임의 변경하지 않습니다.

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
- 가입자용 공개 WhatsApp 인증: **`/orbit/join`**. React·Tailwind 화면에서 SMS, QR, WhatsApp 확인을 처리합니다.
- 공개 Meta 웹훅: **`/orbit/webhook/whatsapp`**.
- 공개 Twilio 웹훅: **`/orbit/twilio/...`**.
- 내부 Node 실행기: `http://127.0.0.1:4786` (직접 공개 금지).
- 관리 웹 API: **`/orbit/api/...`** (FastAPI 관리 인증 뒤에만 접근).

`ORBIT_PUBLIC_URL`은 **`https://실제도메인/orbit`**로 설정해야 합니다. Node가 Twilio 서명을 검증할 때 외부에서 사용한 URL 경로가 포함돼야 하기 때문입니다. Meta 웹훅 등록에도 `/orbit` 접두사를 포함해야 합니다. Python 게이트웨이는 수신 본문을 재직렬화하지 않고 전달합니다.

### 원격 관리자 인증

외부 도메인에서 운영 콘솔을 열려면 **`ORBIT_ADMIN_TOKEN`** 환경 변수를 강력한 임의 암호로 설정하세요. 로그인하면 12시간 만료 HTTP-only 세션 쿠키가 발급됩니다. 비밀번호는 브라우저 로컬 저장소에 보관하지 않습니다. 로컬 루프백으로만 접속한 경우에는 별도 로그인 없이 운영할 수 있습니다. 기존 FastAPI 인증 정책이 더 엄격하다면 해당 정책을 추가로 적용하세요. `/orbit/api/*`는 절대로 무인증으로 프록시 공개하지 마세요.

`ORBIT_CONTROL_PORT`, `ORBIT_PORT`, `ORBIT_WORKER_URL` 등의 값은 사용자의 포트 환경에 맞게 바꿀 수 있습니다. FastAPI 접두사 `/orbit`도 `create_router`의 `prefix`와 `include_router`의 경로를 동시에 바꿔 조정할 수 있습니다.

## 운영 흐름

1. 운영 콘솔의 **모델·에이전트**에서 모델 URL·모델명·소유자 WhatsApp 번호·사용자 업무 원칙을 설정합니다.
2. **연결·진단**에서 Meta WhatsApp 및 Twilio 설정·API 진단을 수행합니다.
3. 사용자는 `/orbit/join`에서 SMS/QR로 등록하고 WhatsApp 1:1 채팅으로 실제 업무를 지시합니다.
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
