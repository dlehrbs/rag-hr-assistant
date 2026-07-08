# DY HR Chatbot — Frontend

DY HR Chatbot의 Next.js 프론트엔드입니다. 사내 HR 규정 질의응답 챗봇의 웹 UI와 외부 삽입용 위젯(widget.js)을 포함합니다.

## 기술 스택

- **Framework**: Next.js 16.2.1 (App Router, Standalone 빌드)
- **Language**: TypeScript
- **State**: Zustand (`useChatStore`)
- **Styling**: Tailwind CSS

## 주요 구성

```
src/
├── app/
│   ├── page.tsx          # 메인 채팅 화면
│   ├── admin/page.tsx    # 관리자 대시보드
│   ├── login/page.tsx    # 로그인
│   └── api/auth/         # 인증 프록시 (Next.js API Route)
├── components/
│   ├── chat/             # 채팅 UI 컴포넌트
│   └── layout/           # 사이드바, 테마
└── store/
    └── useChatStore.ts   # 전역 대화 상태

public/
├── widget.js             # 외부 사이트 삽입용 플로팅 위젯
└── test.html             # 위젯 POC 테스트 페이지
```

## 개발 실행

```bash
npm install
npm run dev
```

## 프로덕션 빌드

Docker Compose로 자동 빌드됩니다. 직접 빌드 시:

```bash
npm run build
```

> **참고**: 프로덕션 환경에서는 루트의 `docker-compose.yml`을 사용하세요.
