// 앱 전역 에러 → 사용자 친화 메시지 분류기.
// 모든 에러 경우의 수(인증/요청과다/서버/네트워크/입력/용량/권한/중단/기타)를 한 곳에서 한국어로 매핑.

export interface AppError {
  kind:
    | 'aborted'      // 사용자가 중단 — 팝업 표시 안 함
    | 'auth'         // 401 세션 만료
    | 'forbidden'    // 403 권한 없음
    | 'rate'         // 429 요청 과다
    | 'too_large'    // 413 용량 초과
    | 'bad_request'  // 400 입력 오류(너무 김 등)
    | 'server'       // 5xx 서버/AI 오류
    | 'network'      // 연결 실패
    | 'timeout'      // 응답 지연
    | 'unknown';     // 기타
  title: string;
  message: string;
}

export function classifyError(err: any): AppError {
  const raw = String(err?.message ?? err ?? '');
  const name = err?.name ?? '';

  // 사용자가 '중지' 누른 경우 — 에러 아님
  if (name === 'AbortError' || /abort/i.test(raw)) {
    return { kind: 'aborted', title: '', message: '' };
  }

  // "Server returned 429" 등에서 상태코드 추출
  const codeMatch = raw.match(/\b(4\d\d|5\d\d)\b/);
  const status = err?.status ?? (codeMatch ? parseInt(codeMatch[1], 10) : 0);

  if (status === 401) return {
    kind: 'auth', title: '로그인이 필요합니다',
    message: '로그인 세션이 만료되었습니다. 다시 로그인한 후 이용해주세요.',
  };
  if (status === 403) return {
    kind: 'forbidden', title: '권한이 없습니다',
    message: '이 작업을 수행할 권한이 없습니다. 필요한 경우 관리자에게 문의해주세요.',
  };
  if (status === 429) return {
    kind: 'rate', title: '요청이 너무 많습니다',
    message: '짧은 시간에 많은 요청이 들어왔습니다. 잠시 후(약 1분 뒤) 다시 시도해주세요.',
  };
  if (status === 413) return {
    kind: 'too_large', title: '파일이 너무 큽니다',
    message: '업로드 가능한 용량을 초과했습니다. 더 작은 파일로 나누어 다시 시도해주세요.',
  };
  if (status === 400) return {
    kind: 'bad_request', title: '요청을 처리할 수 없습니다',
    message: '입력이 너무 길거나 형식이 올바르지 않습니다. 질문을 줄이거나 다시 작성해주세요. 긴 문서는 파일 업로드를 이용해주세요.',
  };
  if (status >= 500) return {
    kind: 'server', title: '일시적인 서버 오류',
    message: 'AI 서버가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해주세요. 계속되면 관리자에게 문의해주세요.',
  };

  // fetch 자체 실패(네트워크) — 보통 TypeError 'Failed to fetch'
  if (name === 'TypeError' || /failed to fetch|networkerror|load failed|readablestream/i.test(raw)) {
    return {
      kind: 'network', title: '네트워크 연결 오류',
      message: '서버에 연결할 수 없습니다. 인터넷 연결 또는 사내망 접속 상태를 확인한 뒤 다시 시도해주세요.',
    };
  }
  if (/timeout|timed out/i.test(raw)) return {
    kind: 'timeout', title: '응답이 지연되고 있습니다',
    message: '서버 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해주세요.',
  };

  return {
    kind: 'unknown', title: '문제가 발생했습니다',
    message: '예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' + (raw ? `\n(오류: ${raw.slice(0, 80)})` : ''),
  };
}
