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
      const viewport = surfaceRoot.querySelector('.xterm-viewport') as HTMLElement | null;
      const savedScrollTop = viewport?.scrollTop ?? 0;

      parentElement.appendChild(surfaceRoot);

      if (viewport && savedScrollTop > 0) {
        viewport.scrollTop = savedScrollTop;
      }
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
