import { useSyncExternalStore } from "react";

const subscribe = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};

export function usePageVisibility() {
  return useSyncExternalStore(subscribe, () => !document.hidden);
}
