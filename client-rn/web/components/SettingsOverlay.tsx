import React from 'react';
import { ArrowLeftIcon, CheckIcon, MicIcon } from './icons';

interface SettingsOverlayProps {
  isOpen: boolean;
  language: string;
  tr: (key: string) => string;
  supportedLanguages: ReadonlyArray<{ code: string; label: string }>;
  onClose: () => void;
  onApplyLanguage: (code: string) => void;
}

export function SettingsOverlay({
  isOpen,
  language,
  tr,
  supportedLanguages,
  onClose,
  onApplyLanguage,
}: SettingsOverlayProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <header className="settings-topbar">
          <div className="settings-topbar-left">
            <button
              className="settings-back-btn"
              onClick={onClose}
              type="button"
              aria-label="Close settings"
            >
              <ArrowLeftIcon />
            </button>
            <h2>{tr('settingsTitle')}</h2>
          </div>
        </header>

        <div className="settings-content">
          <div className="settings-section settings-language-section">
            <div className="settings-section-head">
              <h3>{tr('languageLabel')}</h3>
              <span className="settings-section-tag">System Voice</span>
            </div>

            <div className="settings-language-list">
              {supportedLanguages.map(({ code, label }) => (
                <button
                  key={code}
                  className={`settings-language-btn ${language === code ? 'selected' : ''}`}
                  onClick={() => onApplyLanguage(code)}
                  type="button"
                >
                  <div className="settings-language-copy">
                    <span className="settings-language-dot" aria-hidden />
                    <span>{label}</span>
                  </div>
                  {language === code ? <CheckIcon /> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-section settings-mic-card">
            <div className="settings-mic-icon-wrap" aria-hidden>
              <MicIcon />
            </div>
            <h3>{tr('micSection')}</h3>
            <p className="mic-hint">{tr('micPermission')}</p>
            <button
              className="action-btn primary settings-mic-btn"
              type="button"
              onClick={() =>
                navigator.mediaDevices
                  ?.getUserMedia({ audio: true })
                  .catch(() => {})
              }
            >
              {tr('micRequestAccess')}
            </button>
          </div>

          <footer className="system-info">
            <div className="system-info-grid">
              <div>
                <span>Version</span>
                <strong>v1.1.0</strong>
              </div>
              <div>
                <span>Platform</span>
                <strong>Browser</strong>
              </div>
            </div>
            <p className="system-info-brand">
              <span aria-hidden />ASSISTANT PRO
            </p>
          </footer>
        </div>
      </section>
    </div>
  );
}
