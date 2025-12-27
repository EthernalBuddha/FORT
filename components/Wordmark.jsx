export default function Wordmark({
  className = "",
  markClassName = "",
  wordClassName = "",
  size = 88,
  gapEm = 0.16,
  iconEm = 0.58,
  iconShiftXEm = 0.0,
  iconShiftYEm = 0.10,
  iconKernEm = -0.08,
}) {
  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: `${gapEm}em`,
        fontSize: `${size}px`,
        lineHeight: 1,
      }}
    >
      <img
        src="/arcsafe-a.png"
        alt="ArcSafe"
        className={markClassName}
        style={{
          height: `${iconEm}em`,
          width: "auto",
          display: "block",
          marginRight: `${iconKernEm}em`,
          transform: `translate(${iconShiftXEm}em, ${iconShiftYEm}em)`,
        }}
      />
      <span className={wordClassName} style={{ lineHeight: 1, display: "block" }}>
        rcSafe
      </span>
    </div>
  );
}
