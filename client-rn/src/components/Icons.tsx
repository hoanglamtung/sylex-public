import React from 'react';
import Svg, { Path, G } from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
}

export const AppleIcon = ({ size = 24, color = '#000000' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.09l-.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
      fill={color}
    />
  </Svg>
);

export const GoogleIcon = ({ size = 24, color = '#1F2937' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <Path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <Path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <Path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </Svg>
);

export const BackIcon = ({ size = 24, color = '#A1ACBA' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 15 15" fill="none">
    <Path
      d="M7.5 1.5L1.5 7.5L7.5 13.5M2.5 7.5H13.5"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const CheckmarkIcon = ({ size = 20, color = '#00E5FF' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path
      d="M16.6668 5L7.50016 14.1667L3.3335 10"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const MicrophoneIcon = ({ size = 24, color = '#00E5FF' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 16 23" fill="none">
    <Path
      d="M8 14.5C10.21 14.5 12 12.71 12 10.5V4.5C12 2.29 10.21 0.5 8 0.5C5.79 0.5 4 2.29 4 4.5V10.5C4 12.71 5.79 14.5 8 14.5ZM14.8 10.5C14.8 14.5 11.9 17.3 8 17.3C4.1 17.3 1.2 14.5 1.2 10.5H0C0 15.1 3.4 18.9 7.5 19.4V22.5H8.5V19.4C12.6 18.9 16 15.1 16 10.5H14.8Z"
      fill={color}
    />
  </Svg>
);

export const ChatIcon = ({ size = 19, color = '#A1ACBA' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 19 23" fill="none">
    <Path
      d="M16.5 1.5H2.5C1.4 1.5 0.5 2.4 0.5 3.5V22.5L4.5 18.5H16.5C17.6 18.5 18.5 17.6 18.5 16.5V3.5C18.5 2.4 17.6 1.5 16.5 1.5Z"
      fill={color}
    />
  </Svg>
);

export const SettingsIcon = ({ size = 19, color = '#A1ACBA' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 19 23" fill="none">
    <Path
      d="M16.5 12.5C16.5 12.22 16.48 11.95 16.45 11.68L18.34 10.21C18.52 10.07 18.57 9.81 18.46 9.6L16.66 6.4C16.55 6.19 16.29 6.12 16.07 6.19L13.87 7.04C13.41 6.69 12.92 6.4 12.39 6.18L12.04 3.87C12.01 3.64 11.81 3.5 11.57 3.5H7.97C7.73 3.5 7.53 3.64 7.5 3.87L7.15 6.18C6.62 6.4 6.13 6.69 5.67 7.04L3.47 6.19C3.25 6.12 2.99 6.19 2.88 6.4L1.08 9.6C0.97 9.81 1.02 10.07 1.2 10.21L3.09 11.68C3.06 11.95 3.04 12.22 3.04 12.5C3.04 12.78 3.06 13.05 3.09 13.32L1.2 14.79C1.02 14.93 0.97 15.19 1.08 15.4L2.88 18.6C2.99 18.81 3.25 18.88 3.47 18.81L5.67 17.96C6.13 18.31 6.62 18.6 7.15 18.82L7.5 21.13C7.53 21.36 7.73 21.5 7.97 21.5H11.57C11.81 21.5 12.01 21.36 12.04 21.13L12.39 18.82C12.92 18.6 13.41 18.31 13.87 17.96L16.07 18.81C16.29 18.88 16.55 18.81 16.66 18.6L18.46 15.4C18.57 15.19 18.52 14.93 18.34 14.79L16.45 13.32C16.48 13.05 16.5 12.78 16.5 12.5ZM9.77 16C7.84 16 6.27 14.43 6.27 12.5C6.27 10.57 7.84 9 9.77 9C11.7 9 13.27 10.57 13.27 12.5C13.27 14.43 11.7 16 9.77 16Z"
      fill={color}
    />
  </Svg>
);
