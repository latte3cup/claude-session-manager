import { useCallback, useEffect, useRef, useState } from "react";
import { uiPx } from "../utils/uiScale";

/**
 * 푸시투토크 음성 입력 버튼.
 * 꾹 누르는 동안 브라우저의 Web Speech API로 음성을 인식하고, 떼면 인식된 텍스트를
 * onText로 넘긴다 (Terminal에서 sendInput → PTY로 직접 전송 = 붙여넣기와 동일 경로).
 * 자동 엔터는 넣지 않는다 — 오인식 교정 후 사용자가 직접 전송하도록.
 *
 * 제약: 마이크 API는 보안 컨텍스트(HTTPS 또는 localhost)에서만 동작한다.
 * 평문 http://LAN-IP 접속에서는 브라우저가 마이크를 차단하므로 unsupported로 표시된다.
 */

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlternative;
  length: number;
}
interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechRecognitionErrorLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type VoiceState = "idle" | "listening" | "denied" | "unsupported";

const MicIcon = ({ muted = false }: { muted?: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="21" />
    {muted && <line x1="4" y1="4" x2="20" y2="20" stroke="var(--danger, #e5484d)" />}
  </svg>
);

interface Props {
  onText: (text: string) => void;
  lang?: string;
  style?: React.CSSProperties;
}

export default function VoiceInputButton({ onText, lang = "ko-KR", style }: Props) {
  const ctorRef = useRef<SpeechRecognitionCtor | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const activeRef = useRef(false);
  const [state, setState] = useState<VoiceState>("idle");

  useEffect(() => {
    const ctor = getRecognitionCtor();
    if (!ctor || !window.isSecureContext) {
      setState("unsupported");
      return;
    }
    ctorRef.current = ctor;
    return () => {
      const rec = recRef.current;
      if (rec && activeRef.current) {
        // 콜백을 먼저 떼고 abort — abort가 발생시키는 onend에서 누적 텍스트가
        // onText로 전송되어(언마운트 후 유령 입력) 터미널에 들어가는 걸 막는다.
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try { rec.abort(); } catch { /* noop */ }
      }
    };
  }, []);

  const start = useCallback(() => {
    const ctor = ctorRef.current;
    if (!ctor || activeRef.current) return;

    const rec = new ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    finalRef.current = "";

    rec.onresult = (event) => {
      let finals = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finals += result[0].transcript;
      }
      if (finals) finalRef.current += finals;
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setState("denied");
      }
    };
    rec.onend = () => {
      activeRef.current = false;
      const text = finalRef.current.trim();
      if (text) onText(text);
      setState((prev) => (prev === "denied" || prev === "unsupported" ? prev : "idle"));
    };

    recRef.current = rec;
    try {
      rec.start();
      activeRef.current = true;
      if (navigator.vibrate) navigator.vibrate(12);
      setState("listening");
    } catch {
      activeRef.current = false;
    }
  }, [lang, onText]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && activeRef.current) {
      try { rec.stop(); } catch { /* noop */ }
    }
  }, []);

  const listening = state === "listening";
  const blocked = state === "unsupported" || state === "denied";

  const btnStyle: React.CSSProperties = {
    height: 34,
    padding: "0 8px",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    background: listening ? "var(--danger, #e5484d)" : "var(--surface-3)",
    color: listening ? "#fff" : blocked ? "var(--text-muted, #888)" : "var(--accent)",
    fontSize: uiPx(12),
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    cursor: "pointer",
    whiteSpace: "nowrap",
    WebkitTapHighlightColor: "transparent",
    userSelect: "none",
    touchAction: "none",
    opacity: blocked ? 0.55 : 1,
    animation: listening ? "voice-pulse 1s ease-in-out infinite" : undefined,
    ...style,
  };

  if (blocked) {
    return (
      <button
        type="button"
        style={btnStyle}
        onClick={() => {
          window.alert(
            state === "denied"
              ? "마이크 권한이 거부되었습니다. 브라우저 사이트 설정에서 마이크를 허용해 주세요."
              : "음성 입력은 HTTPS 접속에서만 동작합니다. (평문 http에서는 브라우저가 마이크를 차단)\nTailscale serve 등으로 https 주소로 접속하면 사용할 수 있습니다.",
          );
        }}
        aria-label="음성 입력 사용 불가"
      >
        <MicIcon muted />
      </button>
    );
  }

  return (
    <button
      type="button"
      style={btnStyle}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        stop();
      }}
      onPointerCancel={() => stop()}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={listening ? "녹음 중 — 떼면 입력" : "꾹 눌러 음성 입력"}
    >
      <MicIcon />
      <span style={{ fontSize: uiPx(10) }}>{listening ? "듣는 중" : "음성"}</span>
    </button>
  );
}
