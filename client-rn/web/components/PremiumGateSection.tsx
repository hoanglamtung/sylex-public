import React from 'react';

interface PremiumGateSectionProps {
  onUpgrade: () => void;
}

export function PremiumGateSection({ onUpgrade }: PremiumGateSectionProps) {
  return (
    <section className="premium-gate" aria-label="Premium feature gate">
      <div className="premium-gate-copy">
        <span className="material-symbols-outlined premium-gate-icon" aria-hidden style={{ fontVariationSettings: '"FILL" 1' }}>
          auto_awesome
        </span>
        <div>
          <p className="premium-gate-title">UNLOCK PREMIUM VERSION</p>
          <p className="premium-gate-subtitle">Get 10x faster response and voice clones</p>
        </div>
      </div>
      <button className="premium-gate-btn" type="button" onClick={onUpgrade}>
        Upgrade
      </button>
    </section>
  );
}
