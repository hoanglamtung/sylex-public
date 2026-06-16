import React from 'react';
import { MenuIcon } from './icons';

interface HeaderSectionProps {
  isPremiumUser: boolean;
  onOpenLoginScreen: () => void;
  onToggleSettings: () => void;
}

export function HeaderSection({ isPremiumUser, onOpenLoginScreen, onToggleSettings }: HeaderSectionProps) {
  return (
    <header className="header">
      <div className="header-brand">
        <button className="header-avatar-btn" type="button" aria-label="Open login" onClick={onOpenLoginScreen}>
          <div className="header-avatar" aria-hidden>
            <span className="material-symbols-outlined header-avatar-icon" style={{ fontVariationSettings: '"FILL" 1' }}>
              account_circle
            </span>
          </div>
        </button>
        <h1>ASSISTANT PRO</h1>
      </div>
      <div className="header-actions">
        <span className="pro-pill" aria-label={isPremiumUser ? 'Pro plan' : 'Free plan'}>
          {isPremiumUser ? 'PRO' : 'FREE'}
        </span>
        <button className="header-menu-btn" onClick={onToggleSettings} type="button" aria-label="Open settings menu">
          <MenuIcon />
        </button>
      </div>
    </header>
  );
}
