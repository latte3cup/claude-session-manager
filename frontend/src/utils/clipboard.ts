// 클립보드 복사 헬퍼.
// - 보안 컨텍스트(HTTPS 또는 localhost/127.0.0.1)에서는 표준 Async Clipboard API 사용.
// - 그 외(원격 HTTP: LAN IP·Tailscale IP 등)에서는 navigator.clipboard가 막히므로
//   구식 execCommand('copy')로 폴백한다. 이는 "쓰기 전용"이며 사용자 동작 중에만
//   동작하므로(복사하는 본인 데이터), 클립보드 읽기(붙여넣기)와 달리 보안 위험이 없다.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 권한 거부 등 → 폴백 시도
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  // 원래 포커스(터미널 입력 등) 복원
  try {
    active?.focus?.();
  } catch {
    /* ignore */
  }
  return ok;
}
