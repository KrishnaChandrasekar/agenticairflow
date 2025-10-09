import React from "react";

const SpikeGraphLogo = ({ size = 48 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: "inline-block", verticalAlign: "middle" }}
  >
    <g transform="rotate(-90 12 12)">
      <circle cx="12" cy="6" r="4" fill="#2563eb" />
      <circle cx="6" cy="20" r="2" fill="#2563eb" />
      <circle cx="12" cy="20" r="2" fill="#143d6b" />
      <circle cx="18" cy="20" r="2" fill="#2563eb" />
      <line x1="12" y1="10" x2="6" y2="20" stroke="#2563eb" strokeWidth="1" />
      <line x1="12" y1="10" x2="12" y2="20" stroke="#2563eb" strokeWidth="1" />
      <line x1="12" y1="10" x2="18" y2="20" stroke="#2563eb" strokeWidth="1" />
    </g>
  </svg>
);

export default SpikeGraphLogo;
