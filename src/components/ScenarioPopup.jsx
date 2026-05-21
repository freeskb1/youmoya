import { useEffect, useState, useRef } from "react";
import { colors, radius, shadow } from "../lib/theme";

// 시나리오 팝업 (너모야 모드 전용)
// scenario: { scenario, optionA, optionB }
// onAnswer: ("A" | "B") => void
// leadPlayer: { nickname } (점수 모드 시 누구 답변 예측인지 표시용)
// isLead: 내가 선플레이어인지 (true면 "내 답변" 표시)
// subMode: "score" | "fun"
export default function ScenarioPopup({
  open,
  currentStep,
  totalSteps,
  scenario,
  onAnswer,
  leadPlayer,
  isLead,
  subMode,
}) {
  const [animate, setAnimate] = useState(false);
  const [locked, setLocked] = useState(false);
  const lockTimerRef = useRef(null);

  useEffect(() => {
    if (open) {
      setAnimate(false);
      // 잠금은 setTimeout 으로만 풀림 (연타 방지)
      const t = setTimeout(() => setAnimate(true), 10);
      return () => clearTimeout(t);
    }
  }, [open, scenario?.scenario]);

  useEffect(() => {
    return () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, []);

  function handleAnswer(answer) {
    if (locked) return;
    setLocked(true);
    onAnswer(answer);
    lockTimerRef.current = setTimeout(() => setLocked(false), 1000);
  }

  if (!open || !scenario) return null;

  return (
    <>
      {/* 배경 어두움 */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(40,30,20,0.78)",
          backdropFilter: "blur(2px)",
          opacity: animate ? 1 : 0,
          transition: "opacity 0.25s",
          zIndex: 1000,
        }}
      />

      {/* 팝업 박스 */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: animate
            ? "translate(-50%, -50%) scale(1)"
            : "translate(-50%, -50%) scale(0.92)",
          opacity: animate ? 1 : 0,
          transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
          width: "calc(100vw - 32px)",
          maxWidth: 380,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: colors.cardBg,
          border: `2px solid ${colors.cardBorderDeep}`,
          borderRadius: radius.xl,
          padding: "22px 18px 18px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.18)",
          zIndex: 1001,
        }}
      >
        {/* 단계 표시 */}
        <div style={{ display: "flex", justifyContent: "center", gap: 5, marginBottom: 10 }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: i < currentStep ? colors.accentDeep : colors.border1,
              }}
            />
          ))}
        </div>

        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 10px",
            borderRadius: 100,
            background: colors.accentBg,
            color: colors.accentDeep,
            letterSpacing: 0.3,
          }}>
            {currentStep}단계 / {totalSteps}
          </span>
        </div>

        {/* 마쵸바 톤의 헤드 메시지 (점수 모드 한정) */}
        {subMode !== "fun" && leadPlayer && (
          <p style={{
            textAlign: "center",
            fontSize: 13,
            fontWeight: 700,
            color: colors.text1,
            margin: "0 0 10px",
            lineHeight: 1.4,
          }}>
            {isLead ? "당신의 답변은?" : `${leadPlayer.nickname}는 어떻게 답할까요?`}
          </p>
        )}

        {/* 시나리오 */}
        <div
          style={{
            padding: "14px 14px",
            borderRadius: radius.lg,
            background: colors.surface,
            border: `1px solid ${colors.border1}`,
            marginBottom: 14,
          }}
        >
          <p style={{
            fontSize: 14,
            fontWeight: 600,
            color: colors.text1,
            margin: 0,
            lineHeight: 1.5,
            wordBreak: "keep-all",
            textAlign: "center",
          }}>
            {scenario.scenario}
          </p>
        </div>

        {/* A/B 버튼 - 세로 (중립 색상, 정답/오답 느낌 제거) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={() => handleAnswer("A")}
            disabled={locked}
            style={{
              padding: "14px 12px",
              borderRadius: radius.lg,
              background: colors.surface,
              color: colors.text1,
              fontSize: 14,
              fontWeight: 700,
              border: `2px solid ${colors.border2}`,
              boxShadow: shadow.sm,
              cursor: locked ? "default" : "pointer",
              fontFamily: "inherit",
              opacity: locked ? 0.6 : 1,
              transition: "opacity 0.15s",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{
              fontSize: 13,
              fontWeight: 800,
              background: colors.accentBg,
              color: colors.accentDeep,
              padding: "3px 11px",
              borderRadius: 100,
              flexShrink: 0,
            }}>
              A
            </span>
            <span style={{ flex: 1, lineHeight: 1.3 }}>{scenario.optionA}</span>
          </button>

          <button
            onClick={() => handleAnswer("B")}
            disabled={locked}
            style={{
              padding: "14px 12px",
              borderRadius: radius.lg,
              background: colors.surface,
              color: colors.text1,
              fontSize: 14,
              fontWeight: 700,
              border: `2px solid ${colors.border2}`,
              boxShadow: shadow.sm,
              cursor: locked ? "default" : "pointer",
              fontFamily: "inherit",
              opacity: locked ? 0.6 : 1,
              transition: "opacity 0.15s",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{
              fontSize: 13,
              fontWeight: 800,
              background: colors.accentBg,
              color: colors.accentDeep,
              padding: "3px 11px",
              borderRadius: 100,
              flexShrink: 0,
            }}>
              B
            </span>
            <span style={{ flex: 1, lineHeight: 1.3 }}>{scenario.optionB}</span>
          </button>
        </div>
      </div>
    </>
  );
}
