export function IndiaFlag({
  className = "h-5 w-[30px]",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 900 600"
      className={className}
      role="img"
      aria-label="India"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="900" height="200" fill="#FF9933" />
      <rect y="200" width="900" height="200" fill="#FFFFFF" />
      <rect y="400" width="900" height="200" fill="#138808" />
      <g transform="translate(450 300)" stroke="#000080" fill="none">
        <circle r="87" strokeWidth="8" />
        <circle r="12" fill="#000080" strokeWidth="2" />
        {Array.from({ length: 24 }, (_, i) => (
          <path
            key={i}
            d="M0 -12 L0 -83"
            strokeWidth="3"
            transform={`rotate(${i * 15})`}
          />
        ))}
      </g>
    </svg>
  );
}
