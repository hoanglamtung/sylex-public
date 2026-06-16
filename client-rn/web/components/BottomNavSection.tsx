import React from 'react';
import { ChatIcon, GearIcon, MicIcon, UpgradeIcon, VaultIcon } from './icons';

interface BottomNavSectionProps {
  isPremiumUser: boolean;
  onOpenUpgrade: () => void;
}

export function BottomNavSection({ isPremiumUser, onOpenUpgrade }: BottomNavSectionProps) {
  return (
    <footer className="bottom-nav-shell">
      <nav className="bottom-nav-items" aria-label="Primary navigation">
        <button className="bottom-nav-item" type="button" disabled aria-disabled="true" title="Coming soon">
          <ChatIcon />
          <span>Chat</span>
        </button>
        <button className="bottom-nav-item active" type="button" aria-current="page">
          <MicIcon />
          <span>Voice</span>
        </button>
        <button className="bottom-nav-item" type="button" disabled aria-disabled="true" title="Coming soon">
          <VaultIcon />
          <span>Vault</span>
        </button>
        <button className="bottom-nav-item" type="button" onClick={onOpenUpgrade}>
          {isPremiumUser ? <GearIcon /> : <UpgradeIcon />}
          <span>{isPremiumUser ? 'Manage' : 'Upgrade'}</span>
        </button>
      </nav>
    </footer>
  );
}
