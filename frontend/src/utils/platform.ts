// 플랫폼별 보조키 표기. 윈도우/리눅스 → "Ctrl", 맥 → "⌘".
// 사용자 대다수가 윈도우라 기본은 Ctrl로 보이고, 맥에서만 ⌘로 표시된다.
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export const MOD_KEY = isMac ? '⌘' : 'Ctrl';
