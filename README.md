# 너모야 🎮

친구들과 모여 각자 폰으로 접속하는 모바일 파티 게임. 친구를 얼마나 아는지 추리하는 두 가지 게임 모드를 제공합니다.

## 게임 모드

### 🎯 마쵸바
선플레이어를 향한 N개 질문에 다른 사람들이 어떻게 답할지 예측. 맞춘 개수만큼 점수. (5/7/10문제, 1~3바퀴)

### 🎭 너모야
**점수 모드** — 시나리오 양자택일 (A/B). 선플레이어의 선택을 다른 사람들이 예측. (5/10/15시나리오)

**재미 모드** — 모두 동시에 양자택일에 답변. 영혼의 단짝, 정반대 영혼, 가장 독특한 답변, 호불호 갈린 시나리오 발표. (4명+, 선플레이어 없음)

## 🛠 기술 스택

- **React 18 + Vite 5**
- **Firebase Realtime Database** + **Anonymous Auth**
- **inline style** (CSS-in-JS, 별도 라이브러리 없음)
- **GitHub → Vercel** 자동 배포

---

## 🚀 시작하기

### 1단계 - Firebase 프로젝트 만들기

1. [Firebase Console](https://console.firebase.google.com) 에서 새 프로젝트 생성
2. 프로젝트 생성 후 **웹 앱 추가** (`</>`아이콘) → 아무 닉네임 입력 → 호스팅 체크박스는 비워둠
3. 표시되는 `firebaseConfig` 값 메모 (나중에 .env에 입력)

#### Realtime Database 활성화

1. 좌측 메뉴 **Build → Realtime Database** → **데이터베이스 만들기**
2. 위치 선택 (예: 아시아 - asia-southeast1) → **잠금 모드**로 시작
3. **규칙(Rules) 탭**으로 이동 → `firebase-rules.json` 파일 내용 복사 붙여넣기 → 게시

#### Anonymous Auth 활성화

1. 좌측 메뉴 **Build → Authentication** → **시작하기**
2. **Sign-in method** 탭 → **익명** → **사용 설정** → 저장

### 2단계 - 로컬 개발 환경

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env.local
# .env.local 파일을 열어서 Firebase config 값 입력

# 3. 개발 서버 실행
npm run dev
```

브라우저에서 http://localhost:5173 접속

> **모바일에서 같이 테스트하려면**: 같은 Wi-Fi에 연결한 폰에서 `http://[PC_IP]:5173` 접속.
> Vite 가 시작될 때 콘솔에 표시되는 `Network: http://192.168.x.x:5173` 주소를 사용하세요.

### 3단계 - GitHub 푸시

```bash
git init
git add .
git commit -m "Initial commit: Neomoya"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/neomoya.git
git push -u origin main
```

### 4단계 - Vercel 배포

1. [vercel.com](https://vercel.com) 가입 (GitHub 연동)
2. **New Project** → GitHub 저장소 선택
3. **Framework Preset**: Vite (자동 인식)
4. **Environment Variables** 에 다음 7개 추가:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_DATABASE_URL`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
5. **Deploy** 클릭

배포된 URL 로 접속 가능. QR 코드는 자동으로 이 URL 기반으로 생성됩니다.

#### Firebase에 Vercel 도메인 추가

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. Vercel에서 받은 도메인 추가 (예: `neomoya.vercel.app`)

---

## 📁 프로젝트 구조

```
neomoya/
├── index.html              # Vite 진입점
├── src/
│   ├── main.jsx            # React 진입점
│   ├── App.jsx             # 라우터
│   ├── pages/
│   │   ├── HomePage.jsx    # 시작 화면
│   │   ├── JoinPage.jsx    # 방 입장 (코드 입력)
│   │   ├── RoomPage.jsx    # 방 페이지 (대기실)
│   │   ├── GamePlay.jsx    # 모드별 라우터 + 최종 결과
│   │   ├── MachobaPlay.jsx # 마쵸바 모드 진행
│   │   └── NeomoyaPlay.jsx # 너모야 모드 진행 (점수/재미)
│   ├── components/
│   │   ├── Avatar.jsx
│   │   ├── StepPopup.jsx     # 마쵸바 YES/NO 팝업
│   │   └── ScenarioPopup.jsx # 너모야 시나리오 A/B 팝업
│   └── lib/
│       ├── firebase.js     # Firebase 클라이언트 + Auth
│       ├── room.js         # 방/게임 액션 (DB 쓰기)
│       ├── game.js         # 게임 로직 (풀 생성, 점수, 통계)
│       ├── questions.js    # 마쵸바용 질문 풀 (260개)
│       ├── scenarios.js    # 너모야용 시나리오 풀 (170+)
│       ├── storage.js      # 로컬 스토리지 (플레이어 ID, 닉네임)
│       └── theme.js        # 디자인 토큰 (색상, radius)
├── firebase-rules.json     # Firebase DB 보안 규칙
├── vercel.json             # Vercel SPA 라우팅
└── .env.example            # 환경변수 예시
```

---

## 🎮 게임 흐름

1. 방장이 **방 만들기** → 3자리 코드 + QR 자동 생성
2. 친구들이 **코드 입력 또는 QR 스캔**으로 입장 (폰 기본 카메라로 QR 찍으면 URL 자동 열림)
3. 방장이 모드 선택 (마쵸바 또는 너모야) → **게임 시작** 클릭
4. 매 라운드마다:
   - 선플레이어 발표 (라운드별 순환)
   - 일반 플레이어는 선플레이어가 어떻게 답할지 예측
   - 모두 예측 완료 → 선플레이어가 답변 (일반 플레이어 화면에 같은 질문이 실시간으로 공유됨)
   - 결과 정리 + 정답 공개 + 점수 부여
5. 모든 라운드 완료 → 우승자 + "나를 잘 맞춘 사람 TOP 3" 발표

---

## 🔧 개발 팁

### 질문/시나리오 추가 수정

- 마쵸바 질문: `src/lib/questions.js`
- 너모야 시나리오: `src/lib/scenarios.js`

### 로컬 스토리지 초기화

브라우저 콘솔에서:
```js
localStorage.clear();
```

### Firebase 데이터 확인

Firebase Console → Realtime Database → 데이터 탭에서 실시간으로 게임 상태 관찰 가능. 디버깅에 유용.

---

## 📝 라이선스

MIT
