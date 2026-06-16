import React from 'react';
import { MicIcon, SpeakerIcon } from './icons';

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

interface VoiceStageSectionProps {
  voiceState: VoiceState;
  errorKey: string | null;
  speechRecognitionAvailable: boolean;
  isPremiumUser: boolean;
  pickerPreviewUrl: string | null;
  transcript: string;
  replyText: string;
  speakingProgress: number;
  voiceHeading: string;
  tr: (key: string) => string;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  onPressStart: React.PointerEventHandler<HTMLButtonElement>;
  onPressEnd: React.PointerEventHandler<HTMLButtonElement>;
  onImagePickerClick: () => void;
  onImagePickerFileChange: React.ChangeEventHandler<HTMLInputElement>;
  onRetry: () => void;
  onDismissError: () => void;
}

export function VoiceStageSection({
  voiceState,
  errorKey,
  speechRecognitionAvailable,
  isPremiumUser,
  pickerPreviewUrl,
  transcript,
  replyText,
  speakingProgress,
  voiceHeading,
  tr,
  imageInputRef,
  onPressStart,
  onPressEnd,
  onImagePickerClick,
  onImagePickerFileChange,
  onRetry,
  onDismissError,
}: VoiceStageSectionProps) {
  return (
    <>
      {voiceState === 'idle' && (
        <div className="idle-orb-wrap-stitch">
          <div className="idle-orb-stitch-bg" />
          <div className="idle-orb-stitch-spin" />
          <button
            className="idle-orb-stitch group"
            onPointerDown={onPressStart}
            onPointerUp={onPressEnd}
            onPointerCancel={onPressEnd}
            onContextMenu={(event) => event.preventDefault()}
            type="button"
            title={!speechRecognitionAvailable ? 'Speech recognition not supported' : undefined}
            aria-label="Hold to talk"
          >
            <div className="idle-orb-stitch-main orb-pulse flex flex-col items-center justify-center">
              <span className="material-symbols-outlined mic-icon-stitch" style={{ fontVariationSettings: '"FILL" 1' }}>
                mic
              </span>
              <span className="idle-orb-stitch-label">INITIALIZE</span>
            </div>
            <div className="idle-orb-stitch-aura" />
          </button>

          {isPremiumUser ? (
            <>
              <input
                ref={imageInputRef}
                className="orb-image-picker-input"
                type="file"
                accept="image/*"
                onChange={onImagePickerFileChange}
              />
              <button
                className="orb-image-picker-btn"
                type="button"
                onClick={onImagePickerClick}
                aria-label="Upload image"
                title="Upload image"
              >
                {pickerPreviewUrl ? (
                  <span className="orb-image-picker-thumb-wrap" aria-hidden>
                    <img className="orb-image-picker-thumb" src={pickerPreviewUrl} alt="Selected" />
                  </span>
                ) : (
                  <span className="material-symbols-outlined orb-image-picker-icon" aria-hidden>
                    add_photo_alternate
                  </span>
                )}
              </button>
            </>
          ) : null}
        </div>
      )}

      {voiceState === 'listening' && (
        <div className="content-panel listening-panel">
          <div className="waveform" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
          <p className="state-pill cyan">{tr('state_listening')}</p>
        </div>
      )}

      {voiceState === 'processing' && (
        <div className="content-panel processing-panel">
          <div className="dual-spinner" aria-hidden>
            <div className="spinner outer" />
            <div className="spinner inner" />
          </div>
          {transcript && (
            <div className="transcript-display">
              <p className="transcript-label">{tr('state_you_said')}</p>
              <p className="transcript">{transcript}</p>
            </div>
          )}
          <p className="state-pill cyan">{tr('state_processing')}</p>
        </div>
      )}

      {voiceState === 'speaking' && (
        <div className="content-panel speaking-panel">
          <div className="speaker-orb-wrap">
            <div className="speaker-orb-glow" />
            <div className="speaker-orb">
              <SpeakerIcon />
            </div>
          </div>

          {replyText && (
            <div className="transcript-display speaking-response">
              <p className="transcript">{replyText}</p>
            </div>
          )}

          <div className="progress-track" aria-hidden>
            <div className="progress-fill" style={{ width: `${speakingProgress}%` }} />
          </div>

          <p className="state-pill magenta">{tr('state_speaking')}</p>
        </div>
      )}

      {voiceState === 'error' && errorKey && (
        <div className="content-panel error-panel">
          <p className="error-title">{tr('error_banner_title')}</p>
          <p className="error-message">{tr(errorKey)}</p>
          <div className="error-actions">
            <button className="action-btn primary" onClick={onRetry} type="button">
              {tr('error_banner_retry')}
            </button>
            <button className="action-btn secondary" onClick={onDismissError} type="button">
              {tr('backButton')}
            </button>
          </div>
        </div>
      )}

      <div className="voice-copy-block">
        <h2 className="voice-copy-title">{voiceHeading}</h2>
      </div>
    </>
  );
}
