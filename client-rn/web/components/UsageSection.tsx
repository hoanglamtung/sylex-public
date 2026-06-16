import React from 'react';

interface UsageSectionProps {
  isPremiumUser: boolean;
  showUsageIndicators: boolean;
  dailyRemaining: number;
  dailyLimit: number;
  quotaRemainingPercent: number;
  dailyResetLabel: string;
  onWatchAdReward: () => void;
}

export function UsageSection({
  isPremiumUser,
  showUsageIndicators,
  dailyRemaining,
  dailyLimit,
  quotaRemainingPercent,
  dailyResetLabel,
  onWatchAdReward,
}: UsageSectionProps) {
  if (!showUsageIndicators) {
    return null;
  }

  return (
    <div className="usage-stack" aria-label="Usage indicators">
      <section className="usage-indicator">
        {isPremiumUser ? (
          <div className="stitch-premium-pill">
            <span className="stitch-premium-dot" aria-hidden></span>
            <span className="stitch-premium-label">Pro Active • Unlimited Access</span>
          </div>
        ) : (
          <>
            <div className="usage-meta-row">
              <span>Daily limit</span>
              <span className="usage-value">{`${dailyRemaining}/${dailyLimit} remaining`}</span>
            </div>
            <div className="usage-progress-track" aria-hidden>
              <div className="usage-progress-fill" style={{ width: `${quotaRemainingPercent}%` }} />
            </div>
            <p className="usage-session-copy">{`Daily limit renews in ${dailyResetLabel}`}</p>
          </>
        )}
      </section>

      {!isPremiumUser ? (
        <button className="usage-reward-cta" type="button" onClick={onWatchAdReward}>
          <span className="material-symbols-outlined usage-reward-cta-icon" aria-hidden>
            smart_display
          </span>
          <span>Watch Ad for +5 Commands</span>
        </button>
      ) : null}
    </div>
  );
}
