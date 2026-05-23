import { useEffect, useState } from "react";
import { colors, radius, shadow } from "../lib/theme";

// 확인 다이얼로그
// open: 표시 여부
// title: 제목 (선택)
// message: 본문 (줄바꿈 \n 지원)
// confirmLabel: 확인 버튼 라벨 (기본 "확인")
// cancelLabel: 취소 버튼 라벨 (기본 "취소")
// danger: true 면 확인 버튼이 빨간색 (위험 액션)
// onConfirm: 확인 콜백
// onCancel: 취소/배경 클릭 콜백
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  danger = false,
  onConfirm,
  onCancel,
}) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (open) {
      // 다음 프레임에 애니메이션 시작
      const t = setTimeout(() => setAnimate(true), 10);
      return () => clearTimeout(t);
    } else {
      setAnimate(false);
    }
  }, [open]);

  // ESC 키로 취소
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onCancel?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <>
      {/* 어두운 배경 */}
      <div
        onClick={onCancel}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(40,30,20,0.55)",
          backdropFilter: "blur(2px)",
          opacity: animate ? 1 : 0,
          transition: "opacity 0.2s",
          zIndex: 2000,
        }}
      />
      {/* 모달 */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: animate
            ? "translate(-50%, -50%) scale(1)"
            : "translate(-50%, -50%) scale(0.92)",
          opacity: animate ? 1 : 0,
          transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
          width: "calc(100vw - 48px)",
          maxWidth: 340,
          background: colors.surface,
          borderRadius: radius.xl,
          padding: "22px 18px 16px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.18)",
          zIndex: 2001,
        }}
      >
        {title && (
          <p style={{
            fontSize: 15,
            fontWeight: 700,
            color: colors.text1,
            margin: "0 0 8px",
            textAlign: "center",
            lineHeight: 1.4,
          }}>
            {title}
          </p>
        )}
        {message && (
          <p style={{
            fontSize: 13,
            color: colors.text2,
            margin: "0 0 18px",
            textAlign: "center",
            lineHeight: 1.5,
            whiteSpace: "pre-line",
          }}>
            {message}
          </p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: radius.lg,
              background: colors.surface2,
              color: colors.text2,
              fontSize: 13,
              fontWeight: 600,
              border: `1px solid ${colors.border1}`,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: radius.lg,
              background: danger
                ? `linear-gradient(180deg, ${colors.wrongFillLight} 0%, ${colors.wrongFill} 100%)`
                : `linear-gradient(180deg, ${colors.accentText} 0%, ${colors.accentDeep} 100%)`,
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 700,
              border: "none",
              boxShadow: shadow.button,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
