// 세션별 터미널 스크롤 위치를 컴포넌트 생명주기와 무관하게 보관.
// visibility 토글(keepAlive)뿐 아니라 언마운트/리마운트 전환에서도 복원하기 위해
// 모듈 레벨 Map에 저장한다.
//
// 절대 좌표(viewportY) 대신 "맨 아래로부터의 거리(fromBottom)"를 저장한다.
// fit()으로 reflow가 일어나면 전체 라인 수가 바뀌어 절대 좌표는 무의미해지지만,
// 터미널은 항상 맨 아래에 새 출력이 쌓이므로 bottom-relative 좌표가 더 강건하다.

interface ScrollPosition {
  fromBottom: number; // baseY - viewportY
  wasAtBottom: boolean;
}

const store = new Map<string, ScrollPosition>();

export function saveTerminalScroll(sessionId: string, pos: ScrollPosition): void {
  store.set(sessionId, pos);
}

export function getTerminalScroll(sessionId: string): ScrollPosition | undefined {
  return store.get(sessionId);
}

export function clearTerminalScroll(sessionId: string): void {
  store.delete(sessionId);
}
