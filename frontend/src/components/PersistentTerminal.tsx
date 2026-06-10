import { type ComponentProps, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import Terminal from "./Terminal";

type PersistentTerminalProps = ComponentProps<typeof Terminal> & {
  hostElement: HTMLElement | null;
  keepAliveRootElement: HTMLElement | null;
};

export default function PersistentTerminal({
  hostElement,
  keepAliveRootElement,
  ...terminalProps
}: PersistentTerminalProps) {
  const surfaceRoot = useMemo(() => {
    const element = document.createElement("div");
    element.className = "terminal-surface-root";
    element.dataset.terminalSurfaceRoot = terminalProps.sessionId;
    return element;
  }, [terminalProps.sessionId]);

  const parentElement = hostElement ?? keepAliveRootElement;
  // 표시 중 마지막으로 안정적이던 host 크기. 숨김 전환 시 인라인 고정에 사용한다.
  const lastHostSizeRef = useRef<{ width: number; height: number } | null>(null);

  // surfaceRoot를 현재 위치(host=표시 / keepAlive=숨김)로 이동한다.
  // 숨김으로 전환할 때 surfaceRoot에 직전 host 크기를 인라인 width/height로 고정한다.
  // 그래야 숨김 컨테이너(keepAlive) 폭과 무관하게 xterm의 cols(= 폭 ÷ 글자폭)가 유지되어,
  // 다시 표시할 때 reflow(한 줄→줄바꿈 깜빡임)가 없다. host별 폭이 다른 분할 레이아웃에서도
  // 각 세션이 자기 host 폭을 정확히 보존한다.
  useLayoutEffect(() => {
    if (hostElement) {
      // 표시: host로 먼저 이동한 뒤 인라인 고정을 해제한다(순서 중요 — 해제를 keepAlive 안에서
      // 먼저 하면 한 프레임 크기가 keepAlive 폭으로 튀어 ResizeObserver가 불필요하게 발화한다).
      // 같은 폭의 host로 돌아오는 일반 전환에서는 크기 전이가 아예 없다.
      if (surfaceRoot.parentElement !== hostElement) {
        hostElement.appendChild(surfaceRoot);
      }
      surfaceRoot.style.width = "";
      surfaceRoot.style.height = "";
      // 표시 중 host의 안정적 폭을 기록. 숨김 전환 순간은 레이아웃 과도기(host slot이 잠깐
      // 2개 공존)라 폭이 절반으로 잡힐 수 있으므로, 그 순간 측정값 대신 이 ref를 쓴다.
      const w = hostElement.offsetWidth;
      const h = hostElement.offsetHeight;
      if (w > 0 && h > 0) {
        lastHostSizeRef.current = { width: w, height: h };
      }
    } else if (keepAliveRootElement) {
      // 숨김: 마지막으로 안정적이던 host 크기로 고정(과도기 폭 회피).
      // ref가 아직 없을 때만(한 번도 표시된 적 없음) 현재 측정값으로 폴백.
      let size = lastHostSizeRef.current;
      if (!size && surfaceRoot.parentElement) {
        const rect = surfaceRoot.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          size = { width: rect.width, height: rect.height };
        }
      }
      if (size) {
        surfaceRoot.style.width = `${size.width}px`;
        surfaceRoot.style.height = `${size.height}px`;
      }
      if (surfaceRoot.parentElement !== keepAliveRootElement) {
        keepAliveRootElement.appendChild(surfaceRoot);
      }
    }
  }, [hostElement, keepAliveRootElement, surfaceRoot]);

  // 언마운트(또는 세션 교체로 surfaceRoot가 새로 생성될 때)에만 DOM에서 제거한다.
  // host↔keepAlive 이동 중에는 제거하지 않아야 위의 getBoundingClientRect 측정이 유효하다.
  useLayoutEffect(() => {
    return () => {
      surfaceRoot.parentElement?.removeChild(surfaceRoot);
    };
  }, [surfaceRoot]);

  if (!parentElement) {
    return null;
  }

  return createPortal(
    <Terminal
      {...terminalProps}
      visible={Boolean(hostElement)}
    />,
    surfaceRoot,
  );
}
