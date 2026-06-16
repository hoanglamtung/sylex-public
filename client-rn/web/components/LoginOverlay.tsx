import React from 'react';

interface LoginOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginOverlay({ isOpen, onClose }: LoginOverlayProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="login-overlay" role="dialog" aria-modal aria-label="Login">
      <div className="login-bg" aria-hidden>
        <div className="login-bg-layer login-bg-base" />
        <div className="login-bg-layer login-bg-glow-top" />
        <div className="login-bg-layer login-bg-glow-bottom" />
        <div className="login-bg-layer login-bg-pattern" />
      </div>

      <button className="login-back-btn" type="button" onClick={onClose} aria-label="Back">
        <span className="material-symbols-outlined" aria-hidden>arrow_back</span>
      </button>

      <main className="login-main">
        <header className="login-header">
          <div className="login-logo-wrap" aria-hidden>
            <span className="material-symbols-outlined login-logo-icon" style={{ fontVariationSettings: '"FILL" 1' }}>
              bubble_chart
            </span>
          </div>
          <h2>Welcome back</h2>
          <p>
            Access your neural core and sync your digital workspace across all nodes.
          </p>
        </header>

        <div className="login-actions">
          <button className="login-btn login-btn-apple" type="button">
            <svg className="login-btn-icon" viewBox="0 0 384 512" aria-hidden>
              <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
            </svg>
            <span>Continue with Apple</span>
          </button>
          <button className="login-btn login-btn-google" type="button">
            <svg className="login-btn-icon" viewBox="0 0 24 24" aria-hidden>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c3.11 0 5.72-1.03 7.63-2.81l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C4.1 20.53 7.8 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.69 0 3.21.58 4.41 1.72l3.31-3.31C17.71 2.04 15.11 1 12 1 7.8 1 4.1 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 5.16-4.53z" fill="#EA4335" />
            </svg>
            <span>Continue with Google</span>
          </button>
        </div>

        <div className="login-separator" aria-hidden>
          <span />
          <strong>OR</strong>
          <span />
        </div>

        <div className="login-footer-actions">
          <button className="login-guest-btn" type="button" onClick={onClose}>
            Continue as Guest
          </button>
          <p className="login-legal-copy">
            By continuing, you agree to our <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
