import { colors, radius } from "../lib/theme";

// selected: "0Y", "0N", "1Y", "1N", "2Y", "2N" 또는 null
export default function VoteBoxes({ selected, disabled, onSelect }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
      {[0, 1, 2].map((idx) => (
        <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <VoteButton
            value={`${idx}Y`}
            label="YES"
            selected={selected === `${idx}Y`}
            disabled={disabled}
            onSelect={onSelect}
            type="yes"
          />
          <VoteButton
            value={`${idx}N`}
            label="NO"
            selected={selected === `${idx}N`}
            disabled={disabled}
            onSelect={onSelect}
            type="no"
          />
        </div>
      ))}
    </div>
  );
}

function VoteButton({ value, label, selected, disabled, onSelect, type }) {
  const baseColor = type === "yes" ? colors.correctFill : colors.wrongFill;
  const baseBg = type === "yes" ? colors.correctBg : colors.wrongBg;
  const baseText = type === "yes" ? colors.correctText : colors.wrongFill;

  return (
    <button
      disabled={disabled}
      onClick={() => onSelect && onSelect(value)}
      style={{
        padding: "9px 2px",
        borderRadius: radius.sm,
        textAlign: "center",
        border: selected ? `2px solid ${baseColor}` : `0.5px solid ${colors.border1}`,
        background: selected ? baseColor : baseBg,
        opacity: disabled && !selected ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        fontSize: 11,
        fontWeight: 600,
        color: selected ? "#FFFFFF" : baseText,
        transition: "transform 0.15s",
      }}
    >
      {label}
    </button>
  );
}
