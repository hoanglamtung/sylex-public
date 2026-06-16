import React, { useState } from 'react';
import { CloseIcon } from './icons';

const COMPARE_ROWS = [
  { feature: 'Daily requests', free: '30', pro: 'Unlimited' },
  { feature: 'Context memory', free: 'None', pro: 'Session-scoped' },
  { feature: 'Image picker', free: '✕', pro: '✓' },
  { feature: 'Use chat', free: '✕', pro: '✓' },
  { feature: 'Routines', free: '✕', pro: '✓' },
  { feature: 'Hands-Free ("Hey Sylex")', free: '✕', pro: '✓' },
  { feature: 'Summaries', free: '✕', pro: '✓' },
  { feature: 'Long-form tasks', free: '✕', pro: '✓' },
  { feature: 'Cross-device sync', free: '✕', pro: '✓' },
  { feature: 'Ads', free: 'Yes', pro: 'No' },
  { feature: 'Personal Assistant', free: 'No', pro: 'v1.2' },
  { feature: 'Business Assistant', free: 'No', pro: 'v1.3' },
  { feature: 'Kid Assistant', free: 'No', pro: 'v1.4' },
  { feature: 'Car Assistant', free: 'No', pro: 'v1.5' },
];

interface UpgradePanelProps {
  onClose: () => void;
  dailyRemaining: number;
  dailyLimit: number;
}

export function UpgradePanel({ onClose, dailyRemaining, dailyLimit }: UpgradePanelProps) {
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('yearly');
  const used = dailyLimit - dailyRemaining;
  const usedPercent = Math.round((used / dailyLimit) * 100);
  const r = 110;
  const ringSize = 260;
  const ringCenter = ringSize / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - usedPercent / 100);
  const ctaPriceCopy = selectedPlan === 'yearly' ? '$69.99/year' : '$7.99/month';

  return (
    <div className="upgrade-overlay" role="dialog" aria-modal aria-label="Upgrade to Pro">
      <header className="upgrade-top-bar">
        <span className="upgrade-top-title">ASSISTANT PRO</span>
        <button className="upgrade-close-btn" type="button" onClick={onClose} aria-label="Close upgrade">
          <CloseIcon />
        </button>
      </header>

      <div className="upgrade-body">
        <div className="upgrade-usage-ring-wrap">
          <svg className="upgrade-ring-svg" viewBox={`0 0 ${ringSize} ${ringSize}`} aria-hidden>
            <circle cx={ringCenter} cy={ringCenter} r={r} fill="transparent" stroke="rgba(23,39,54,0.8)" strokeWidth="5" />
            <circle
              cx={ringCenter}
              cy={ringCenter}
              r={r}
              fill="transparent"
              stroke="#81ecff"
              strokeWidth="5"
              strokeDasharray={`${circ}`}
              strokeDashoffset={`${offset}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${ringCenter} ${ringCenter})`}
            />
          </svg>
          <div className="upgrade-ring-label">
            <span className="upgrade-ring-count">{used}/{dailyLimit}</span>
            <span className="upgrade-ring-sub">Commands</span>
          </div>
        </div>
        <p className="upgrade-usage-caption">
          You've reached <span className="upgrade-usage-pct">{usedPercent}%</span> of your daily limit
        </p>

        <div className="upgrade-headline-block">
          <h1 className="upgrade-headline">
            Unlock the <span className="upgrade-headline-accent">Full Potential</span><br />of Your Voice Assistant
          </h1>
          <p className="upgrade-subtext">
            Experience zero latency, unlimited access, and the most realistic neural voices ever created.
          </p>
        </div>

        <div className="upgrade-table-section">
          <h2 className="upgrade-table-heading">Free vs Pro Comparison</h2>
          <div className="upgrade-table-wrap">
            <table className="upgrade-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Free</th>
                  <th className="upgrade-th-pro">Pro</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map(({ feature, free, pro }) => (
                  <tr key={feature}>
                    <td>{feature}</td>
                    <td className="upgrade-td-center upgrade-td-free">{free}</td>
                    <td className="upgrade-td-center upgrade-td-pro">{pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="upgrade-plans">
          <button
            className={`upgrade-plan-card ${selectedPlan === 'monthly' ? 'upgrade-plan-selected' : ''}`}
            type="button"
            onClick={() => setSelectedPlan('monthly')}
            aria-pressed={selectedPlan === 'monthly'}
          >
            <span className="upgrade-plan-period">Monthly</span>
            <span className="upgrade-plan-price">$7.99</span>
            <span className="upgrade-plan-note">Billed every month</span>
          </button>
          <button
            className={`upgrade-plan-card upgrade-plan-featured ${selectedPlan === 'yearly' ? 'upgrade-plan-selected' : ''}`}
            type="button"
            onClick={() => setSelectedPlan('yearly')}
            aria-pressed={selectedPlan === 'yearly'}
          >
            <span className="upgrade-plan-best">Best Value</span>
            <span className="upgrade-plan-period upgrade-plan-period-pro">Yearly</span>
            <span className="upgrade-plan-price">$69.99</span>
            <span className="upgrade-plan-note">Save 27% annually</span>
          </button>
        </div>

        <div style={{ height: 160 }} />
      </div>

      <div className="upgrade-cta-bar">
        <button className="upgrade-cta-btn" type="button">Get Pro Now • {ctaPriceCopy}</button>
        <p className="upgrade-cta-legal">
          Cancel anytime.{' '}
          <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener noreferrer">Terms</a>
          {' · '}
          <a href="https://silverleaf.studio/#privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
