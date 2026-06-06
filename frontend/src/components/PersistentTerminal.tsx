import { type ComponentProps, useLayoutEffect, useMemo } from "react";
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

  useLayoutEffect(() => {
    if (!parentElement) {
      return;
    }

    if (surfaceRoot.parentElement !== parentElement) {
      // DOM 이동만 수행. 스크롤 복원은 Terminal의 xterm API 경로로 일원화한다
      // (DOM scrollTop 직접 조작은 xterm 내부 상태와 어긋나 점프를 유발).
      parentElement.appendChild(surfaceRoot);
    }

    return () => {
      if (surfaceRoot.parentElement === parentElement) {
        parentElement.removeChild(surfaceRoot);
      }
    };
  }, [parentElement, surfaceRoot]);

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
