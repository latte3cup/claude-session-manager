import { useRef, useEffect, useCallback, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useWebSocket, getWsUrl } from "../hooks/useWebSocket";
import { openExternal, getClipboardFilePaths, revealInFileExplorer } from "../runtime";
import MobileKeyBar from "./MobileKeyBar";
import FileExplorer from "./FileExplorer";
import GitPanel, { GitIcon } from "./GitPanel";
import { getCliTone } from "../utils/cliTones";
import { copyToClipboard } from "../utils/clipboard";

/* ---- Web Speech (push-to-talk) minimal typings ---- */
interface SpeechAlt { transcript: string }
interface SpeechRes { isFinal: boolean; 0: SpeechAlt; length: number }
interface SpeechResList { length: number; [i: number]: SpeechRes }
interface SpeechEventLike { resultIndex: number; results: SpeechResList }
interface SpeechRecLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecCtor = new () => SpeechRecLike;
function getSpeechCtor(): SpeechRecCtor | null {
  if (!window.isSecureContext) return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type MouseEventType = "press" | "release" | "move" | "drag" | "scroll";
type MouseButton = 0 | 1 | 2 | 64 | 65;

interface MouseEventData {
  event: MouseEventType;
  button: MouseButton;
  x: number;
  y: number;
  modifiers: {
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
  };
}

export type ActivityState = "idle" | "processing" | "done";
type ThemeMode = "light" | "dark" | "solarized";

interface TerminalProps {
  sessionId: string;
  visible?: boolean;
  fontSize?: number;
  onFontSizeChange?: (delta: number) => void;
  onActivityChange?: (sessionId: string, state: ActivityState) => void;
  refreshNonce: number;
  isFocused: boolean;
  onFocus: () => void;
  theme: ThemeMode;
  sessionName: string;
  paneLabel?: string;
  workPath: string;
  onClosePanel: () => void;
  canClosePanel?: boolean;
  canSuspend?: boolean;
  onSuspend: () => void;
  onMaximize?: () => void;
  showRestoreLayout?: boolean;
  onRestoreLayout?: () => void;
  onTerminate: () => void;
  showMobileKeyBar?: boolean;
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  connecting: {
    background: "var(--terminal-status-connecting-bg)",
    color: "var(--terminal-status-connecting-text)",
  },
  reconnecting: {
    background: "var(--terminal-status-reconnecting-bg)",
    color: "var(--terminal-status-reconnecting-text)",
  },
  disconnected: {
    background: "var(--terminal-status-disconnected-bg)",
    color: "var(--terminal-status-disconnected-text)",
  },
  auth_failed: {
    background: "var(--terminal-status-disconnected-bg)",
    color: "var(--terminal-status-disconnected-text)",
  },
  taken_over: {
    background: "var(--terminal-status-takenover-bg)",
    color: "var(--terminal-status-takenover-text)",
  },
  not_found: {
    background: "var(--terminal-status-disconnected-bg)",
    color: "var(--terminal-status-disconnected-text)",
  },
  closed: {
    background: "var(--terminal-status-closed-bg)",
    color: "var(--terminal-status-closed-text)",
  },
};

function getTerminalPalette(theme: ThemeMode) {
  if (theme === "light") {
    // Light theme
    return {
      background: "#f5efe0",
      foreground: "#18202b",
      cursor: "#18202b",
      selectionBackground: "#d8deea",
      black: "#303845",
      red: "#b85b63",
      green: "#507c63",
      yellow: "#9b7331",
      blue: "#5175a6",
      magenta: "#8e628f",
      cyan: "#4d8280",
      white: "#d9e0eb",
      brightBlack: "#5a6678",
      brightRed: "#c36d74",
      brightGreen: "#649177",
      brightYellow: "#b58841",
      brightBlue: "#6289bb",
      brightMagenta: "#a377a5",
      brightCyan: "#5c9794",
      brightWhite: "#f5f7fb",
    };
  } else if (theme === "solarized") {
    // Solarized Dark theme (brightened)
    return {
      background: "#002b36",
      foreground: "#b0c4c4",
      cursor: "#a8b8b8",
      selectionBackground: "#0a4a5a",
      black: "#0a4a5a",
      red: "#ef5350",
      green: "#9bb200",
      yellow: "#cca000",
      blue: "#42a5f5",
      magenta: "#e94f8a",
      cyan: "#3cc0b8",
      white: "#f5efe0",
      brightBlack: "#728e96",
      brightRed: "#e06030",
      brightGreen: "#728e96",
      brightYellow: "#7e92a0",
      brightBlue: "#9aabab",
      brightMagenta: "#8585d0",
      brightCyan: "#a8b8b8",
      brightWhite: "#fdf6e3",
    };
  } else {
    // Dark theme (default)
    return {
    background: "#161a21",
    foreground: "#d9e1ee",
    cursor: "#f2f5f8",
    selectionBackground: "#404c60",
    black: "#394555",
    red: "#ef8ca2",
    green: "#9ed7b0",
    yellow: "#f1cd86",
    blue: "#91bfff",
    magenta: "#d7b0ef",
    cyan: "#97ddd9",
    white: "#c2d0e1",
    brightBlack: "#576477",
    brightRed: "#f4a0b2",
    brightGreen: "#b2e6c2",
    brightYellow: "#f5daa1",
    brightBlue: "#a9cdff",
    brightMagenta: "#e1c0f5",
    brightCyan: "#ace6e2",
    brightWhite: "#e7edf7",
  };
  }
}

export default function Terminal({
  sessionId,
  visible = true,
  fontSize = 14,
  onFontSizeChange,
  onActivityChange,
  refreshNonce,
  isFocused,
  onFocus,
  theme,
  sessionName,
  paneLabel = "Terminal",
  workPath,
  onClosePanel,
  canClosePanel = true,
  canSuspend = true,
  onSuspend,
  onMaximize,
  showRestoreLayout = false,
  onRestoreLayout,
  onTerminate,
  showMobileKeyBar = true,
}: TerminalProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef(false);
  const enterTimeRef = useRef(0);
  const mouseDownButtonsRef = useRef(0);
  const composingRef = useRef(false);
  const sendInputRef = useRef<((data: string) => void) | null>(null);
  // 스페이스바 홀드 push-to-talk (물리 키보드 전용, 음성인식은 보안컨텍스트+크롬 필요)
  const voiceCtorRef = useRef<SpeechRecCtor | null>(null);
  const voiceRecRef = useRef<SpeechRecLike | null>(null);
  const voiceActiveRef = useRef(false);
  const voiceFinalRef = useRef("");
  const sendResizeRef = useRef<((cols: number, rows: number) => void) | null>(null);
  const sendMouseRef = useRef<((data: MouseEventData) => void) | null>(null);
  const onActivityChangeRef = useRef(onActivityChange);
  const visibleRef = useRef(visible);
  const focusedRef = useRef(isFocused);
  const themeRef = useRef(theme);
  const fontSizeRef = useRef(fontSize);
  onActivityChangeRef.current = onActivityChange;
  visibleRef.current = visible;
  focusedRef.current = isFocused;
  themeRef.current = theme;
  fontSizeRef.current = fontSize;

  const [explorerOpen, setExplorerOpen] = useState(false);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [shouldInitialize, setShouldInitialize] = useState(visible);
  const [explorerWidth, setExplorerWidth] = useState(() => {
    const stored = localStorage.getItem("explorerWidth");
    return stored ? Number(stored) : 240;
  });
  const [gitPanelWidth, setGitPanelWidth] = useState(() => {
    const stored = localStorage.getItem("gitPanelWidth");
    return stored ? Number(stored) : 300;
  });
  const explorerDragRef = useRef(false);
  const gitPanelDragRef = useRef(false);
  const refreshFramesRef = useRef<number[]>([]);
  const isMobileDevice = () => window.innerWidth <= 768;
  const isMobile = isMobileDevice;
  const [scrollThumb, setScrollThumb] = useState<{ top: number; height: number } | null>(null);
  const [scrollbarActive, setScrollbarActive] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceUnsupported, setVoiceUnsupported] = useState(false);


  const refitAndRefresh = useCallback((restoreFocus = false) => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    const container = innerRef.current;
    if (!term || !fitAddon) return;

    if (container && (container.offsetWidth === 0 || container.offsetHeight === 0)) {
      return;
    }

    // fit 전에 "맨 아래에 붙어있었는지"와 현재 크기를 기록
    const beforeBuf = term.buffer.active;
    const wasAtBottom = beforeBuf.viewportY >= beforeBuf.baseY;
    const prevCols = term.cols;
    const prevRows = term.rows;

    try { fitAddon.fit(); } catch { /* ignore */ }

    const dimsChanged = term.cols !== prevCols || term.rows !== prevRows;

    // 맨 아래에 있었으면 새 출력을 계속 따라가도록 내부 상태를 맨 아래로 유지.
    if (wasAtBottom) {
      try { term.scrollToBottom(); } catch { /* ignore */ }
    }

    // DOM 이동(keepAlive↔host appendChild)은 .xterm-viewport의 scrollTop을 0으로 리셋하지만
    // xterm 내부 상태(viewportY)와 화면(.xterm-screen)은 올바르게 유지된다. 따라서 스크롤바/휠
    // 기준만 내부 상태에 맞춰 픽셀로 재동기화한다. .xterm-screen 렌더는 DOM scrollTop과 무관하므로
    // 이 복원은 화면을 다시 그리지 않는다(깜빡임 없음). scrollToLine 댄스(0↔y 왕복)는 viewport
    // scroll 이벤트와 핑퐁하며 중간 프레임을 만들 수 있어 쓰지 않는다.
    // (v0.4.10에서 직접 설정이 무효화됐던 것은 당시 display:none으로 scrollHeight가 0이었기 때문.
    //  display:none은 v0.4.13에서 제거되어 지금은 직접 설정이 유지된다.)
    try {
      const vp = container?.querySelector(".xterm-viewport") as HTMLElement | null;
      if (vp) {
        const buf = term.buffer.active;
        const total = buf.baseY + term.rows;
        if (total > 0 && vp.scrollHeight > 0) {
          const expected = Math.round((buf.viewportY / total) * vp.scrollHeight);
          if (Math.abs(vp.scrollTop - expected) > 1) {
            vp.scrollTop = expected;
          }
        }
      }
    } catch { /* ignore */ }

    // 크기가 실제로 변했을 때만 무거운 일을 한다. 같은 크기인데도 매번 refresh+resize를 보내면
    // ① 전체 재렌더 ② PTY winsize 재설정 → 그 안의 TUI(claude 등)가 화면 전체를 다시 그려
    // 세션 전환 때마다 깜빡임이 보인다(전환 시 refit이 visible/refreshNonce effect로 2회 이상 실행됨).
    if (dimsChanged) {
      try { term.clearTextureAtlas(); } catch { /* ignore */ }
      try { term.refresh(0, Math.max(term.rows - 1, 0)); } catch { /* ignore */ }
      sendResizeRef.current?.(term.cols, term.rows);
    }

    if (restoreFocus && visibleRef.current && focusedRef.current) {
      term.focus();
    }

  }, []);

  const cancelScheduledHardRefresh = useCallback(() => {
    refreshFramesRef.current.forEach((frame) => cancelAnimationFrame(frame));
    refreshFramesRef.current = [];
  }, []);

  const scheduleHardRefresh = useCallback((restoreFocus = false) => {
    if (!visible || !termRef.current || !fitAddonRef.current) return;

    cancelScheduledHardRefresh();
    const frameIds: number[] = [];

    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => {
        refitAndRefresh(restoreFocus);
        refreshFramesRef.current = [];
      });
      frameIds.push(secondFrame);
      refreshFramesRef.current = [...frameIds];
    });

    frameIds.push(firstFrame);
    refreshFramesRef.current = [...frameIds];
  }, [cancelScheduledHardRefresh, refitAndRefresh, visible]);

  const scheduleHardRefreshRef = useRef(scheduleHardRefresh);
  scheduleHardRefreshRef.current = scheduleHardRefresh;

  const wsUrl = sessionId ? getWsUrl(sessionId) : null;

  const { sendInput, sendResize, sendMouse, status } = useWebSocket({
    url: wsUrl,
    onMessage: (msg) => {
      if (msg.type === "output" && termRef.current) {
        termRef.current.write(msg.data);

        // Only track activity after user pressed Enter
        if (enterTimeRef.current > 0) {
          const elapsed = Date.now() - enterTimeRef.current;

          // Wait 500ms after Enter to skip echo, then mark processing
          if (elapsed > 500 && !isProcessingRef.current) {
            isProcessingRef.current = true;
            onActivityChangeRef.current?.(sessionId, "processing");
          }

          // Reset done-timer on every output chunk
          if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
          activityTimerRef.current = setTimeout(() => {
            if (isProcessingRef.current) {
              onActivityChangeRef.current?.(sessionId, "done");
            }
            isProcessingRef.current = false;
            enterTimeRef.current = 0;
          }, 3000);
        }
      } else if (msg.type === "status" && msg.data === "closed") {
        termRef.current?.write("\r\n\x1b[31m[Session closed]\x1b[0m\r\n");
      } else if (msg.type === "status" && msg.data === "taken_over") {
        termRef.current?.write("\r\n\x1b[33m[Session taken over by another client]\x1b[0m\r\n");
      } else if (msg.type === "status" && msg.data === "not_found") {
        termRef.current?.write("\r\n\x1b[31m[Session not found]\x1b[0m\r\n");
      }
    },
    autoReconnect: true,
  });

  useEffect(() => {
    if (visible) {
      setShouldInitialize(true);
    }
  }, [visible]);

  useEffect(() => {
    if (!shouldInitialize || !innerRef.current || termRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: fontSizeRef.current,
      fontFamily: "'Cascadia Code', 'Malgun Gothic', 'Consolas', monospace",
      fontWeight: "400",
      theme: getTerminalPalette(themeRef.current),
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon((_event: MouseEvent, uri: string) => {
      void openExternal(uri);
    }));

    // Local file path link provider (Windows: C:\..., D:/...)
    // ① 따옴표/백틱으로 감싼 경로: 닫는 구분자까지 안쪽 전체(공백 포함)를 경로로 — 끝점이 명확.
    //    (claude는 경로를 `백틱`이나 "큰따옴표"로 감싸 출력하는 경우가 많음)
    // ② 감싸지 않은 경로: 공백 전까지(공백 없는 일반 경로). 닫는 괄호/꺾쇠 등은 경계로 제외.
    // 파일경로 링크
    // ① 따옴표/백틱 감싼 경로: 안쪽 전체(공백 포함).
    // ② 바레 경로: 공백은 "뒤에 더 경로+구분자(\ 또는 /)가 있을 때만" 소비 →
    //    중간 세그먼트 공백("Claude Workspace\...")은 포함, 경로 뒤 산문(" 이건 산문")은 배제.
    //    ★동기 판정이라 xterm이 밑줄을 즉시 렌더링(비동기 provideLinks는 밑줄이 안 그려짐).
    const filePathRegex =
      /([`"'])([A-Za-z]:[/\\][^`"'\r\n]+?)\1|([A-Za-z]:[/\\][^\s`"'<>|)}\]](?:[^\s`"'<>|)}\]]|\x20(?=[^\s`"'<>|)}\]]*[/\\]))*)/g;
    term.registerLinkProvider({
      provideLinks(lineNumber, callback) {
        const line = term.buffer.active.getLine(lineNumber - 1);
        if (!line) { callback(undefined); return; }
        const text = line.translateToString();
        const links: import("@xterm/xterm").ILink[] = [];
        let match;
        filePathRegex.lastIndex = 0;
        while ((match = filePathRegex.exec(text)) !== null) {
          // match[2] = 따옴표 안쪽 경로, match[3] = 따옴표 없는 경로
          const filePath = match[2] ?? match[3];
          if (!filePath) continue;
          // 검출(range)은 따옴표까지 포함 — 공백 있는 경로를 안전하게 한 덩어리로 잡음.
          // 실제 여는 경로(text/activate)는 따옴표를 뺀 안쪽 경로(match[2]) 사용.
          links.push({
            range: {
              start: { x: match.index + 1, y: lineNumber },
              end: { x: match.index + match[0].length + 1, y: lineNumber },
            },
            text: filePath,
            activate: (event) => {
              if (event.ctrlKey || event.metaKey) {
                void openExternal(`file:///${filePath.replace(/\\/g, "/")}`);
              } else {
                void revealInFileExplorer(filePath);
              }
            },
          });
        }
        callback(links.length > 0 ? links : undefined);
      },
    });

    // 스페이스바 홀드 push-to-talk: 물리 키보드에서 스페이스를 "길게"(HOLD_MS) 누르면
    // 음성 인식을 시작하고, 떼면 인식된 텍스트를 전송한다. 짧게 누르면 평범한 스페이스.
    // auto-repeat(e.repeat)에 의존하지 않고 타이머로 홀드를 판정한다 — 키보드/브라우저에 따라
    // auto-repeat가 안 오는 경우가 있어서다.
    // (음성인식은 Web Speech API — 보안 컨텍스트 + 크롬 필요. WebView/평문http에선 미동작.)
    const HOLD_MS = 350;
    voiceCtorRef.current = getSpeechCtor();
    let spaceDown = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
    const startVoice = () => {
      const ctor = voiceCtorRef.current;
      if (!ctor || voiceActiveRef.current) return;
      const rec = new ctor();
      rec.lang = "ko-KR";
      rec.continuous = true;
      rec.interimResults = true;
      voiceFinalRef.current = "";
      rec.onresult = (ev) => {
        let finals = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) finals += r[0].transcript;
        }
        if (finals) voiceFinalRef.current += finals;
      };
      rec.onerror = () => { /* 권한 거부 등 — onend에서 정리 */ };
      rec.onend = () => {
        voiceActiveRef.current = false;
        setVoiceListening(false);
        const text = voiceFinalRef.current.trim();
        if (text) sendInputRef.current?.(text);
      };
      voiceRecRef.current = rec;
      try {
        rec.start();
        voiceActiveRef.current = true;
        setVoiceListening(true);
        // 홀드 진입 직전 이미 입력된 스페이스 1개를 지운다(초기 keydown이 보낸 것).
        sendInputRef.current?.("\x7f");
      } catch {
        voiceActiveRef.current = false;
        setVoiceListening(false);
      }
    };
    const stopVoice = () => {
      const rec = voiceRecRef.current;
      if (rec && voiceActiveRef.current) {
        try { rec.stop(); } catch { /* noop */ }
      }
    };
    const onVoiceKeyUp = (ev: KeyboardEvent) => {
      if (ev.key !== " ") return;
      spaceDown = false;
      clearHold();
      if (voiceActiveRef.current) stopVoice();
    };
    innerRef.current?.addEventListener("keyup", onVoiceKeyUp);

    // Ctrl/Cmd + Up/Down → 터미널 스크롤백 스크롤. xterm 파이프라인에서 직접 가로채(return false)
    // PTY로는 보내지 않는다. (셸 기본값엔 거의 안 쓰이는 키라 충돌 위험 낮음)
    const SCROLL_KEY_LINES = 3;
    term.attachCustomKeyEventHandler((e) => {
      if (
        (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey &&
        (e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        if (e.type === "keydown") {
          term.scrollLines(e.key === "ArrowUp" ? -SCROLL_KEY_LINES : SCROLL_KEY_LINES);
        }
        return false;
      }
      // 스페이스바 홀드 감지 (지원 시 음성모드, 미지원 브라우저면 안내만)
      if (e.key === " " && e.type === "keydown") {
        const supported = !!voiceCtorRef.current;
        if (supported && voiceActiveRef.current) return false; // 녹음 중이면 스페이스 삼킴
        if (e.repeat) return supported ? false : true;         // 지원 시 반복 스페이스 삼킴(스팸 방지)
        if (!spaceDown) {
          spaceDown = true;
          clearHold();
          holdTimer = setTimeout(() => {
            holdTimer = null;
            if (!spaceDown || composingRef.current) return;
            if (voiceCtorRef.current) {
              startVoice();
            } else {
              // 크롬이 아니거나 보안컨텍스트가 아니어서 음성인식 불가 — 원인 안내
              setVoiceUnsupported(true);
              setTimeout(() => setVoiceUnsupported(false), 2500);
            }
          }, HOLD_MS);
        }
        return true; // 첫 눌림의 스페이스 1개는 평범하게 통과(홀드 확정 시 지움)
      }
      return true;
    });

    // Enable mouse events - SGR mode (1006)
    term.element?.classList.add("xterm-enable-mouse");

    term.open(innerRef.current);
    fitAddon.fit();
    sendResize(term.cols, term.rows);

    // Enable SGR mouse tracking mode (1006)
    // This tells xterm.js to send mouse events via escape sequences
    term.write("\x1b[?1006h");

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    sendInputRef.current = sendInput;
    sendResizeRef.current = sendResize;
    sendMouseRef.current = sendMouse;
    (
      window as Window & {
        __remoteCodeTerminalDebug?: Record<string, { sessionId: string; sessionName: string; term: XTerm }>;
      }
    ).__remoteCodeTerminalDebug ??= {};
    (
      window as Window & {
        __remoteCodeTerminalDebug?: Record<string, { sessionId: string; sessionName: string; term: XTerm }>;
      }
    ).__remoteCodeTerminalDebug![sessionId] = { sessionId, sessionName, term };

    // IME composition tracking for mobile/tablet (prevents duplicate input with Korean etc.)
    const isMobilePlatform = /Android|iPad|iPhone|iPod/i.test(navigator.userAgent);
    const textarea = innerRef.current.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement | null;
    // xterm은 조합 완성 글자를 input 이벤트와 _finalizeComposition(setTimeout) 두 경로로 각각
    // onData에 흘린다. 가드를 한 번만 쓰고 해제하면 두 번째 것이 통과해 마지막 글자가 중복된다
    // (삼성 키보드에서 스페이스로 조합을 끝낼 때 "안녕녕"처럼 나오던 증상).
    // 따라서 가드는 소비하지 않고 시간(DUP_GUARD_MS)으로만 푼다.
    const DUP_GUARD_MS = 250;
    // 자모(U+3130-318F) + 완성형 음절(U+AC00-D7A3)만으로 이뤄진 문자열
    const HANGUL_ONLY_RE = /^[㄰-㆏가-힣]+$/;
    let compositionEndTimer: ReturnType<typeof setTimeout> | null = null;
    let lastComposed = ""; // 직전 조합 완성 문자 — xterm이 같은 글자를 onData로 또 보내는 중복 차단용
    let sawComposition = false; // 이 세션에서 조합형 IME(소프트 키보드) 사용이 확인됨
    const onCompositionStart = () => {
      sawComposition = true;
      composingRef.current = true;
    };
    const onCompositionEnd = (e: CompositionEvent) => {
      // 완성 글자를 직접 전송해 확실히 flush한다.
      // (기존: compositionend 후 30ms간 onData를 막았는데, xterm의 완성-글자 onData가 그 안에
      //  들어오면 같이 막혀서 마지막 한글이 가끔 유실됐다 — "버퍼에서 플러쉬 안 됨" 증상.)
      const text = e.data || "";
      composingRef.current = false;
      if (text) {
        sendInputRef.current?.(text);
        lastComposed = text;
        if (compositionEndTimer) clearTimeout(compositionEndTimer);
        compositionEndTimer = setTimeout(() => {
          lastComposed = "";
          compositionEndTimer = null;
        }, DUP_GUARD_MS);
      }
    };
    // 삼성 IME는 textarea에 누적된 텍스트를 내부 조합 상태와 동기화하려고 재삽입·재작성하고,
    // xterm은 그 변화분을 diff(after.replace(before,""))로 추출해 입력으로 보낸다. IME가 앞부분을
    // 재작성하면 diff 추출이 실패해 누적 텍스트 "전체"가 입력으로 나간다(라인 통째 복사 증상).
    // xterm은 Enter 전까지 textarea를 비우지 않으므로, 입력이 멈추면 우리가 비워서
    // 동기화·diff의 대상 자체를 없앤다. (조합 중/직후엔 건너뜀 — xterm의 pending diff와 충돌 방지)
    let lastInputAt = 0;
    const onAnyInput = () => { lastInputAt = Date.now(); };
    let idleClearTimer: ReturnType<typeof setInterval> | null = null;
    if (isMobilePlatform && textarea) {
      textarea.addEventListener("compositionstart", onCompositionStart);
      textarea.addEventListener("compositionend", onCompositionEnd);
      textarea.addEventListener("input", onAnyInput, { passive: true });
      idleClearTimer = setInterval(() => {
        if (!composingRef.current && textarea.value && Date.now() - lastInputAt > 300) {
          textarea.value = "";
        }
      }, 500);
    }

    term.onData((data) => {
      const sendInput = sendInputRef.current;
      const sendMouse = sendMouseRef.current;

      if (!sendInput || !sendMouse) return;

      if (isMobilePlatform) {
        if (composingRef.current) return; // 조합 중 중간 상태는 보내지 않음
        // 위 compositionend에서 직접 보낸 완성 글자를 xterm이 또 onData로 보내면 무시(중복 방지).
        // 가드를 해제하지 않는 이유는 위 주석 참고 — xterm이 같은 글자를 두 번 보낸다.
        if (lastComposed) {
          if (data === lastComposed) return;
          if (data.startsWith(lastComposed)) {
            // 완성 글자 뒤에 붙어 온 잔여물 처리. xterm의 _finalizeComposition은 textarea를
            // 끝까지 substring하므로, 이미 시작된 "다음 조합"의 첫 자모가 딸려 올 수 있다
            // ("번" 확정 후 data="번ㅇ"). 그 자모의 진짜 값은 다음 compositionend가 보내므로
            // 한글 잔여물은 버리고, 스페이스/엔터 같은 확정 키만 통과시킨다.
            const rest = data.slice(lastComposed.length);
            if (rest && !HANGUL_ONLY_RE.test(rest)) sendInput(rest);
            return;
          }
        }
        // 조합 경로 밖에서 도착한 "짧은 순수 한글" 청크 차단 — 소프트 키보드의 한글 타이핑은
        // 반드시 compositionend(위에서 직접 전송)를 거치므로, 여기로 오는 1~2자 한글은
        // xterm 에코 또는 IME의 유령 재삽입이다 (가만히 있어도 'ㅇ'이 찍히던 증상).
        // 3자 이상은 붙여넣기일 수 있어 통과. 조합 IME 미사용 세션(물리 키보드)도 통과.
        if (sawComposition && data.length <= 2 && HANGUL_ONLY_RE.test(data)) return;
      }

      // Check for mouse escape sequences (SGR 1006 mode)
      if (data.startsWith("\x1b[") && data.includes("M")) {
        // Parse SGR mouse sequence: ESC [ < Pb ; Px ; Py M
        // Or extended: ESC [ < Pb ; Px ; Px ; Py ; Py T (for 1006)
        const match = data.match(/\x1b\[<(\d+);(\d+);(\d+)([MTm])/);
        if (match) {
          const button = parseInt(match[1], 10);
          const x = parseInt(match[2], 10);
          const y = parseInt(match[3], 10);
          const type = match[4];

          let eventType: MouseEventType;
          let actualButton: MouseButton;

          // Button encoding in SGR mode:
          // 0 = left button, 1 = middle, 2 = right
          // 32 = motion flag added
          // 64 = scroll up, 65 = scroll down
          const isMotion = (button & 32) !== 0;
          const buttonNum = button & 3;

          if (button === 64 || button === 65) {
            // Scroll events
            eventType = "scroll";
            actualButton = button as MouseButton;
          } else if (type === "M") {
            // Press (button down)
            if (isMotion) {
              eventType = mouseDownButtonsRef.current > 0 ? "drag" : "move";
            } else {
              eventType = "press";
              mouseDownButtonsRef.current = buttonNum + 1;
            }
            actualButton = buttonNum as MouseButton;
          } else if (type === "m") {
            // Release (button up)
            eventType = "release";
            actualButton = buttonNum as MouseButton;
            mouseDownButtonsRef.current = 0;
          } else {
            return; // Not a mouse event we recognize
          }

          sendMouse({
            event: eventType,
            button: actualButton,
            x: x - 1, // Convert to 0-indexed
            y: y - 1,
            modifiers: {
              shift: false,
              ctrl: false,
              alt: false,
            },
          });
          return;
        }
      }

      // Regular keyboard input
      sendInput(data);
      // Detect Enter key
      if (data.includes("\r") || data.includes("\n")) {
        enterTimeRef.current = Date.now();
      }
    });

    term.onResize(({ cols, rows }) => {
      sendResizeRef.current?.(cols, rows);
    });

    const observer = new ResizeObserver(() => {
      scheduleHardRefreshRef.current(focusedRef.current);
    });
    observer.observe(innerRef.current);

    const container = innerRef.current;
    const viewport = container.querySelector(".xterm-viewport") as HTMLElement | null;

    // Middle mouse button click → scroll to bottom
    const onMiddleClick = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        term.scrollToBottom();
      }
    };
    container.addEventListener("mousedown", onMiddleClick);

    // Mobile touch scroll — immediately block xterm, handle scroll ourselves
    const xtermScreen = container.querySelector(".xterm-screen") as HTMLElement | null;
    const SCROLLBAR_ZONE = 20; // px from right edge — scrollbar touch zone
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let didScroll = false;
    let onScrollbar = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      lastY = startY;
      didScroll = false;

      // Check if touch is on the scrollbar area (right edge)
      const rect = container.getBoundingClientRect();
      onScrollbar = (startX >= rect.right - SCROLLBAR_ZONE);
      if (onScrollbar) setScrollbarActive(true);

      // Block xterm immediately so it never interferes
      if (xtermScreen) xtermScreen.style.pointerEvents = "none";
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !viewport) return;
      const curY = e.touches[0].clientY;

      if (onScrollbar) {
        // Scrollbar drag: map touch Y position to scroll position
        e.preventDefault();
        const vpRect = viewport.getBoundingClientRect();
        const ratio = (curY - vpRect.top) / vpRect.height;
        const maxScroll = viewport.scrollHeight - viewport.clientHeight;
        viewport.scrollTop = Math.max(0, Math.min(ratio * maxScroll, maxScroll));
        didScroll = true;
        return;
      }

      // Start scrolling after 5px vertical movement
      if (!didScroll) {
        const dy = Math.abs(curY - startY);
        const dx = Math.abs(e.touches[0].clientX - startX);
        if (dy > 5 && dy > dx) {
          didScroll = true;
        } else {
          return;
        }
      }

      e.preventDefault();
      viewport.scrollTop += (lastY - curY);
      lastY = curY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      // Restore xterm pointer events
      if (xtermScreen) xtermScreen.style.pointerEvents = "";

      if (onScrollbar) { onScrollbar = false; setScrollbarActive(false); return; }

      // If it was a tap (no scroll), forward click to xterm
      if (!didScroll && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const el = document.elementFromPoint(t.clientX, t.clientY);
        if (el && container.contains(el)) {
          el.dispatchEvent(new MouseEvent("mousedown", {
            clientX: t.clientX, clientY: t.clientY, bubbles: true,
          }));
          el.dispatchEvent(new MouseEvent("mouseup", {
            clientX: t.clientX, clientY: t.clientY, bubbles: true,
          }));
          el.dispatchEvent(new MouseEvent("click", {
            clientX: t.clientX, clientY: t.clientY, bubbles: true,
          }));
        }
      }
    };

    container.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    container.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    container.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: true });

    return () => {
      observer.disconnect();
      container.removeEventListener("mousedown", onMiddleClick);
      container.removeEventListener("touchstart", onTouchStart, { capture: true });
      container.removeEventListener("touchmove", onTouchMove, { capture: true });
      container.removeEventListener("touchend", onTouchEnd, { capture: true });
      container.removeEventListener("touchcancel", onTouchEnd, { capture: true });
      if (textarea) {
        textarea.removeEventListener("compositionstart", onCompositionStart);
        textarea.removeEventListener("compositionend", onCompositionEnd);
        textarea.removeEventListener("input", onAnyInput);
      }
      innerRef.current?.removeEventListener("keyup", onVoiceKeyUp);
      clearHold();
      if (voiceActiveRef.current) {
        // 콜백을 먼저 떼고 abort — abort가 발생시키는 onend에서 누적 텍스트가
        // sendInput으로 전송되어(언마운트 후 유령 입력) PTY에 들어가는 걸 막는다.
        const rec = voiceRecRef.current;
        if (rec) { rec.onresult = null; rec.onerror = null; rec.onend = null; }
        try { rec?.abort(); } catch { /* noop */ }
        voiceActiveRef.current = false;
      }
      if (idleClearTimer) clearInterval(idleClearTimer);
      if (compositionEndTimer) clearTimeout(compositionEndTimer);
      if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
      cancelScheduledHardRefresh();
      const debugStore = (
        window as Window & {
          __remoteCodeTerminalDebug?: Record<string, { sessionId: string; sessionName: string; term: XTerm }>;
        }
      ).__remoteCodeTerminalDebug;
      if (debugStore) {
        delete debugStore[sessionId];
      }
      termRef.current = null;
      fitAddonRef.current = null;
      term.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelScheduledHardRefresh, sessionId, shouldInitialize]);

  // Keep refs in sync without triggering terminal re-initialization
  useEffect(() => {
    sendInputRef.current = sendInput;
    sendResizeRef.current = sendResize;
    sendMouseRef.current = sendMouse;
  }, [sendInput, sendResize, sendMouse]);

  useEffect(() => {
    return () => {
      cancelScheduledHardRefresh();
    };
  }, [cancelScheduledHardRefresh]);

  useEffect(() => {
    const debugStore = (
      window as Window & {
        __remoteCodeTerminalDebug?: Record<string, { sessionId: string; sessionName: string; term: XTerm }>;
      }
    ).__remoteCodeTerminalDebug;
    const entry = debugStore?.[sessionId];
    if (entry) {
      entry.sessionName = sessionName;
    }
  }, [sessionId, sessionName]);

  useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    const container = innerRef.current;
    if (!term || !fitAddon || !container) return;

    const palette = getTerminalPalette(theme);
    term.options.theme = palette;

    const viewport = container.querySelector(".xterm-viewport") as HTMLElement | null;
    const screen = container.querySelector(".xterm-screen") as HTMLElement | null;
    const rows = container.querySelector(".xterm-rows") as HTMLElement | null;

    container.style.backgroundColor = palette.background;
    container.style.color = palette.foreground;
    if (viewport) viewport.style.backgroundColor = palette.background;
    if (screen) screen.style.backgroundColor = palette.background;
    if (rows) rows.style.color = palette.foreground;

    requestAnimationFrame(() => {
      refitAndRefresh(isFocused);
    });
  }, [isFocused, refitAndRefresh, theme]);

  // fontSize change -> update terminal
  useEffect(() => {
    if (termRef.current && fitAddonRef.current && visible) {
      termRef.current.options.fontSize = fontSize;
      scheduleHardRefresh(isFocused);
    }
  }, [fontSize, isFocused, scheduleHardRefresh, visible]);

  // visible / panel toggles -> refit + refresh
  useEffect(() => {
    if (visible && termRef.current && fitAddonRef.current) {
      let cancelled = false;
      requestAnimationFrame(() => {
        if (cancelled) return;
        requestAnimationFrame(() => {
          if (cancelled) return;
          refitAndRefresh(focusedRef.current);
        });
      });
      return () => { cancelled = true; };
    }
  }, [explorerOpen, explorerWidth, gitPanelOpen, gitPanelWidth, refitAndRefresh, visible]);

  useEffect(() => {
    if (!visible || !termRef.current || !fitAddonRef.current) return;
    scheduleHardRefresh(true);
  }, [refreshNonce, scheduleHardRefresh, visible]);

  // Mobile custom scrollbar — track viewport scroll position
  useEffect(() => {
    if (!isMobileDevice()) return;
    const container = innerRef.current;
    if (!container) return;
    const viewport = container.querySelector(".xterm-viewport") as HTMLElement | null;
    if (!viewport) return;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      if (scrollHeight <= clientHeight) { setScrollThumb(null); return; }
      const ratio = clientHeight / scrollHeight;
      const thumbH = Math.max(ratio * clientHeight, 30);
      const trackSpace = clientHeight - thumbH;
      const scrollRatio = scrollTop / (scrollHeight - clientHeight);
      setScrollThumb({ top: scrollRatio * trackSpace, height: thumbH });
    };

    viewport.addEventListener("scroll", update, { passive: true });
    // Also update on resize / content changes
    const mo = new MutationObserver(update);
    mo.observe(viewport, { childList: true, subtree: true, characterData: true });
    update();

    return () => {
      viewport.removeEventListener("scroll", update);
      mo.disconnect();
    };
  }, [visible]);

  // Refit terminal when any panel resize drag ends
  useEffect(() => {
    const handleResizeEnd = () => {
      scheduleHardRefresh(isFocused);
    };
    window.addEventListener("panel-resize-end", handleResizeEnd);
    return () => window.removeEventListener("panel-resize-end", handleResizeEnd);
  }, [isFocused, scheduleHardRefresh]);

  // Focus management
  useEffect(() => {
    if (visible && isFocused && termRef.current) {
      termRef.current.focus();
    }
  }, [visible, isFocused]);

  // 창 포커스 복귀(다른 창 갔다 돌아옴) 시 WebView2/Chromium에서 IME가 helper textarea에
  // 어긋나게 재부착되어 "첫 한글 조합이 중복 입력"되는 버그를, 깨끗한 포커스 사이클
  // (blur→다음 프레임 focus)로 리셋한다. 사용자가 'Alt+Tab 두 번'으로 풀던 동작을 자동화.
  // 입력 대상이 이 터미널일 때(=helper textarea가 activeElement)만 동작해 다른 입력란의
  // 포커스를 가로채지 않는다.
  useEffect(() => {
    // 데스크톱(브라우저/WebView2)에서만. 모바일은 IME 경로가 다르고(위 composition 가드),
    // blur/focus가 소프트 키보드를 깜빡이게 할 수 있어 제외.
    if (/Android|iPad|iPhone|iPod/i.test(navigator.userAgent)) return;
    const onWindowFocus = () => {
      const ta = innerRef.current?.querySelector(
        ".xterm-helper-textarea",
      ) as HTMLTextAreaElement | null;
      if (!ta || document.activeElement !== ta) return;
      ta.blur();
      requestAnimationFrame(() => {
        if (document.hasFocus() && visibleRef.current) ta.focus();
      });
    };
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, []);

  // Ctrl+C: copy if selection exists, otherwise send SIGINT
  // Ctrl+V: paste from clipboard
  useEffect(() => {
    const container = innerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const term = termRef.current;
      if (!term) return;
      const key = e.key.toLowerCase();

      if (key === "c") {
        const selection = term.getSelection();
        if (e.shiftKey || selection) {
          e.preventDefault();
          e.stopPropagation();
          if (selection) {
            void copyToClipboard(selection);
            term.clearSelection();
          }
        }
      } else if (key === "v") {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.readText().then(async (text) => {
          if (text) {
            sendInputRef.current?.(text);
          } else {
            const paths = await getClipboardFilePaths();
            if (paths.length > 0) {
              sendInputRef.current?.(paths.map(p => `"${p}"`).join(" "));
            }
          }
        }).catch(() => {});
      }
    };

    container.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => container.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  // Right-click = paste
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.readText().then(async (text) => {
      if (text) {
        sendInputRef.current?.(text);
      } else {
        const paths = await getClipboardFilePaths();
        if (paths.length > 0) {
          sendInputRef.current?.(paths.map(p => `"${p}"`).join(" "));
        }
      }
    }).catch(() => {});
  }, []);

  const handleKeyBarInput = useCallback(
    (data: string) => {
      sendInput(data);
      // Detect Enter key from key bar
      if (data.includes("\r") || data.includes("\n")) {
        enterTimeRef.current = Date.now();
      }
      // Refocus terminal
      termRef.current?.focus();
    },
    [sendInput],
  );

  const handleInsertPath = useCallback(
    (text: string) => {
      sendInput(text);
      termRef.current?.focus();
    },
    [sendInput],
  );

  const handleExplorerResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    explorerDragRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const startX = e.clientX;
    const startWidth = explorerWidth;

    const onMove = (ev: MouseEvent) => {
      if (!explorerDragRef.current) return;
      const delta = ev.clientX - startX;
      const maxWidth = Math.floor(window.innerWidth * 0.7);
      const newWidth = Math.max(180, Math.min(startWidth + delta, maxWidth));
      setExplorerWidth(newWidth);
    };
    const onUp = () => {
      explorerDragRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setExplorerWidth((w) => {
        localStorage.setItem("explorerWidth", String(w));
        return w;
      });
      window.dispatchEvent(new Event("panel-resize-end"));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [explorerWidth]);

  const handleGitPanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    gitPanelDragRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const startX = e.clientX;
    const startWidth = gitPanelWidth;

    const onMove = (ev: MouseEvent) => {
      if (!gitPanelDragRef.current) return;
      const delta = ev.clientX - startX;
      const maxWidth = Math.floor(window.innerWidth * 0.7);
      const newWidth = Math.max(220, Math.min(startWidth + delta, maxWidth));
      setGitPanelWidth(newWidth);
    };
    const onUp = () => {
      gitPanelDragRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setGitPanelWidth((w) => {
        localStorage.setItem("gitPanelWidth", String(w));
        return w;
      });
      window.dispatchEvent(new Event("panel-resize-end"));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [gitPanelWidth]);

  const showBanner = status !== "connected";
  const statusLabel =
    status === "connecting"
      ? "Connecting..."
      : status === "reconnecting"
        ? "Reconnecting..."
        : status === "auth_failed"
          ? "Authentication expired. Please log in again."
          : status === "taken_over"
            ? "Session taken over by another client."
            : status === "not_found"
              ? "Session not found."
              : status === "closed"
                ? "Session closed."
                : status === "disconnected"
                  ? "Disconnected."
                  : "";
  const statusToneClass =
    status === "connecting" || status === "reconnecting"
      ? "status-info"
      : status === "taken_over" || status === "closed"
        ? "status-warn"
        : "status-danger";

  const iconSize = Math.round(fontSize * 0.86);
  const toolbarTitle = workPath ? `${sessionName} | ${paneLabel} | ${workPath}` : `${sessionName} | ${paneLabel}`;

  return (
    <div
      className="terminal-panel"
      data-testid="terminal-panel"
      style={{
        // display:none을 쓰지 않는다. 숨김은 keepAliveRoot(off-screen + visibility:hidden)가 처리.
        // display:none이면 브라우저가 DOM scrollTop을 0으로 리셋해 복귀 시 스크롤바가 최상단으로 튐.
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
      onMouseDown={onFocus}
    >
      <div
        className={`terminal-toolbar${isFocused ? " is-focused" : ""}`}
        style={{
          minHeight: Math.max(34, Math.round(fontSize * 2.2)),
          padding: `${Math.max(4, Math.round(fontSize * 0.25))}px ${Math.max(10, Math.round(fontSize * 0.5))}px`,
        }}
        title={toolbarTitle}
      >
        <div className="terminal-toolbar__meta">
          <span className="terminal-toolbar__title">{sessionName}</span>
          <span className="terminal-toolbar__separator" aria-hidden="true">|</span>
          <span className="terminal-toolbar__chip">{paneLabel}</span>
        </div>
        <div className="terminal-toolbar__actions">
          <TitleBarBtn
            icon={<FolderIcon size={iconSize} />}
            title="File Explorer"
            hoverColor={getCliTone("folder").hover}
            hoverBackground={getCliTone("folder").soft}
            active={explorerOpen}
            fontSize={fontSize}
            onClick={(e) => { e.stopPropagation(); setExplorerOpen((o) => { if (!o) setGitPanelOpen(false); return !o; }); }}
          />
          <TitleBarBtn
            icon={<GitIcon size={iconSize} />}
            title="Git"
            hoverColor={getCliTone("git").hover}
            hoverBackground={getCliTone("git").soft}
            active={gitPanelOpen}
            fontSize={fontSize}
            onClick={(e) => { e.stopPropagation(); setGitPanelOpen((o) => { if (!o) setExplorerOpen(false); return !o; }); }}
          />
          <TitleBarBtn
            icon={<RefreshIcon size={iconSize} />}
            title="Refresh"
            hoverColor="var(--info)"
            fontSize={fontSize}
            onClick={(e) => {
              e.stopPropagation();
              scheduleHardRefresh(true);
            }}
          />
          {onFontSizeChange && (
            <div className="terminal-font-controls">
              <FontSizeBtn label="-" title="Font Size -" fontSize={fontSize} onClick={(e) => { e.stopPropagation(); onFontSizeChange(-1); }} />
              <span className="terminal-font-value">{fontSize}</span>
              <FontSizeBtn label="+" title="Font Size +" fontSize={fontSize} onClick={(e) => { e.stopPropagation(); onFontSizeChange(1); }} />
            </div>
          )}
          {canSuspend && (
            <TitleBarBtn
              icon={<MinimizeIcon size={iconSize} />}
              title="Suspend"
              hoverColor="var(--warn)"
              fontSize={fontSize}
              onClick={(e) => { e.stopPropagation(); onSuspend(); }}
            />
          )}
          {canClosePanel && (
            <TitleBarBtn
              icon={<PaneCloseIcon size={iconSize} />}
              title="Close Pane"
              hoverColor="var(--danger)"
              fontSize={fontSize}
              onClick={(e) => { e.stopPropagation(); onClosePanel(); }}
            />
          )}
          {showRestoreLayout && onRestoreLayout ? (
            <TitleBarBtn
              icon={<RestoreLayoutIcon size={iconSize} />}
              title="Restore Layout"
              hoverColor="var(--accent)"
              fontSize={fontSize}
              onClick={(e) => {
                e.stopPropagation();
                onRestoreLayout();
              }}
            />
          ) : onMaximize && (
            <TitleBarBtn
              icon={<MaximizeIcon size={iconSize} />}
              title="Open Alone"
              hoverColor="var(--accent)"
              fontSize={fontSize}
              onClick={(e) => { e.stopPropagation(); onMaximize(); }}
            />
          )}
        </div>
      </div>

      {showBanner && (
        <div className={`terminal-statusbar ${statusToneClass}`} style={STATUS_STYLE[status] || undefined}>
          {statusLabel}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {explorerOpen && (
          <div style={{ width: isMobile() ? undefined : explorerWidth, flexShrink: 0 }}>
            <FileExplorer
              rootPath={workPath}
              onInsertPath={handleInsertPath}
              onClose={() => setExplorerOpen(false)}
              isMobile={isMobile()}
            />
          </div>
        )}
        {explorerOpen && !isMobile() && (
          <div
            className="file-explorer-resize"
            onMouseDown={handleExplorerResizeStart}
          />
        )}
        {gitPanelOpen && (
          <div style={{ width: isMobile() ? undefined : gitPanelWidth, flexShrink: 0 }}>
            <GitPanel
              workPath={workPath}
              onClose={() => setGitPanelOpen(false)}
              isMobile={isMobile()}
            />
          </div>
        )}
        {gitPanelOpen && !isMobile() && (
          <div
            className="file-explorer-resize"
            onMouseDown={handleGitPanelResizeStart}
          />
        )}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }} onContextMenu={handleContextMenu}>
          <div ref={innerRef} data-testid="terminal-xterm" style={{ width: "100%", height: "100%" }} />
          {/* 스페이스바 홀드 음성 입력 표시 */}
          {voiceListening && (
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: 24,
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 16px",
                borderRadius: 999,
                background: "var(--danger, #e5484d)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                zIndex: 40,
                pointerEvents: "none",
                boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
                animation: "voice-pulse 1s ease-in-out infinite",
              }}
            >
              🎤 듣는 중… 스페이스 떼면 전송
            </div>
          )}
          {voiceUnsupported && (
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: 24,
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 16px",
                borderRadius: 999,
                background: "var(--surface-3, #333)",
                color: "var(--text-primary, #eee)",
                border: "1px solid var(--border-subtle)",
                fontSize: 13,
                fontWeight: 600,
                zIndex: 40,
                pointerEvents: "none",
                textAlign: "center",
              }}
            >
              ⚠ 이 브라우저는 음성 입력 미지원 — 크롬으로 접속하세요
            </div>
          )}
          {/* Mobile custom scrollbar */}
          {scrollThumb && isMobile() && (
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 18,
                height: "100%",
                pointerEvents: "none",
                zIndex: 10,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: scrollThumb.top,
                  right: 2,
                  width: 10,
                  height: scrollThumb.height,
                  borderRadius: 5,
                  background: scrollbarActive ? "var(--accent)" : "var(--terminal-scrollbar)",
                  border: scrollbarActive ? "1px solid var(--accent-strong)" : "1px solid var(--border-subtle)",
                  transition: "background 0.15s, border 0.15s",
                }}
              />
            </div>
          )}
        </div>
      </div>
      {showMobileKeyBar && <MobileKeyBar onKey={handleKeyBarInput} />}
    </div>
  );
}

/* ---- Title bar helper components ---- */

function FontSizeBtn({ label, title, fontSize = 14, onClick }: { label: string; title: string; fontSize?: number; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      className="terminal-tool-button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        padding: `${Math.round(fontSize * 0.07)}px ${Math.round(fontSize * 0.2)}px`,
        fontSize: Math.round(fontSize * 0.86),
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}

function TitleBarBtn({
  icon,
  title,
  hoverColor,
  hoverBackground,
  active,
  fontSize = 14,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hoverColor: string;
  hoverBackground?: string;
  active?: boolean;
  fontSize?: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  const activeBackground = hoverBackground ?? `${hoverColor}18`;

  return (
    <button
      className={`terminal-tool-button${active ? " is-active" : ""}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        background: active ? activeBackground : "none",
        color: active ? hoverColor : "var(--text-muted)",
        padding: `${Math.round(fontSize * 0.14)}px ${Math.round(fontSize * 0.29)}px`,
        lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.color = hoverColor;
        btn.style.background = activeBackground;
      }}
      onMouseLeave={(e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.style.color = active ? hoverColor : "var(--text-muted)";
        btn.style.background = active ? activeBackground : "none";
      }}
    >
      {icon}
    </button>
  );
}

const MinimizeIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="2" y1="9" x2="10" y2="9" />
  </svg>
);

const MaximizeIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="8" height="8" />
  </svg>
);

const RestoreLayoutIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4.5V2.5h6v6h-2" />
    <rect x="2" y="4" width="6" height="5" rx="0.6" />
  </svg>
);

const PaneCloseIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="3" y1="3" x2="9" y2="9" />
    <line x1="9" y1="3" x2="3" y2="9" />
  </svg>
);

const CloseIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="3" y1="3" x2="9" y2="9" />
    <line x1="9" y1="3" x2="3" y2="9" />
  </svg>
);

const RefreshIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 2v3h3" />
    <path d="M2.1 7.5a4 4 0 1 0 .6-4.2L1.5 5" />
  </svg>
);

const FolderIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 3C1 2.45 1.45 2 2 2h2.5l1 1.5H10c.55 0 1 .45 1 1V9.5c0 .55-.45 1-1 1H2c-.55 0-1-.45-1-1V3z" />
  </svg>
);

