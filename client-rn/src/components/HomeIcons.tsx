import React from 'react';
import Svg, { Path, Polygon } from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
}

export function MicrophoneIcon({ size = 24, color = '#81ECFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 23" fill="none">
      <Path
        d="M8 14.5C10.21 14.5 12 12.71 12 10.5V4.5C12 2.29 10.21 0.5 8 0.5C5.79 0.5 4 2.29 4 4.5V10.5C4 12.71 5.79 14.5 8 14.5ZM14.8 10.5C14.8 14.5 11.9 17.3 8 17.3C4.1 17.3 1.2 14.5 1.2 10.5H0C0 15.1 3.4 18.9 7.5 19.4V22.5H8.5V19.4C12.6 18.9 16 15.1 16 10.5H14.8Z"
        fill={color}
      />
    </Svg>
  );
}

export function MicIcon({ size = 14, color = '#81ECFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 23" fill="none">
      <Path
        d="M7 14.5C9.21 14.5 11 12.71 11 10.5V4.5C11 2.29 9.21 0.5 7 0.5C4.79 0.5 3 2.29 3 4.5V10.5C3 12.71 4.79 14.5 7 14.5ZM12.8 10.5C12.8 14.5 9.9 17.3 7 17.3C4.1 17.3 1.2 14.5 1.2 10.5H0C0 15.1 3.4 18.9 6.5 19.4V22.5H7.5V19.4C11.6 18.9 15 15.1 15 10.5H12.8Z"
        fill={color}
      />
    </Svg>
  );
}

export function ImagePickerIcon({ size = 17, color = '#81ECFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 17 17" fill="none">
      <Path
        d="M14.5 2.5H11.5L10 1H7L5.5 2.5H2.5C1.95 2.5 1.5 2.95 1.5 3.5V14.5C1.5 15.05 1.95 15.5 2.5 15.5H14.5C15.05 15.5 15.5 15.05 15.5 14.5V3.5C15.5 2.95 15.05 2.5 14.5 2.5ZM8.5 13C6.29 13 4.5 11.21 4.5 9C4.5 6.79 6.29 5 8.5 5C10.71 5 12.5 6.79 12.5 9C12.5 11.21 10.71 13 8.5 13Z"
        fill={color}
      />
    </Svg>
  );
}

export function MenuIcon({ size = 28, color = '#81ECFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 33 27" fill="none">
      <Path
        d="M1.5 2.5H31.5M1.5 13.5H31.5M1.5 24.5H31.5"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function GearIcon({ size = 19, color = '#A1ACBA' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 19 23" fill="none">
      <Path
        d="M16.5 12.5C16.5 12.22 16.48 11.95 16.45 11.68L18.34 10.21C18.52 10.07 18.57 9.81 18.46 9.6L16.66 6.4C16.55 6.19 16.29 6.12 16.07 6.19L13.87 7.04C13.41 6.69 12.92 6.4 12.39 6.18L12.04 3.87C12.01 3.64 11.81 3.5 11.57 3.5H7.97C7.73 3.5 7.53 3.64 7.5 3.87L7.15 6.18C6.62 6.4 6.13 6.69 5.67 7.04L3.47 6.19C3.25 6.12 2.99 6.19 2.88 6.4L1.08 9.6C0.97 9.81 1.02 10.07 1.2 10.21L3.09 11.68C3.06 11.95 3.04 12.22 3.04 12.5C3.04 12.78 3.06 13.05 3.09 13.32L1.2 14.79C1.02 14.93 0.97 15.19 1.08 15.4L2.88 18.6C2.99 18.81 3.25 18.88 3.47 18.81L5.67 17.96C6.13 18.31 6.62 18.6 7.15 18.82L7.5 21.13C7.53 21.36 7.73 21.5 7.97 21.5H11.57C11.81 21.5 12.01 21.36 12.04 21.13L12.39 18.82C12.92 18.6 13.41 18.31 13.87 17.96L16.07 18.81C16.29 18.88 16.55 18.81 16.66 18.6L18.46 15.4C18.57 15.19 18.52 14.93 18.34 14.79L16.45 13.32C16.48 13.05 16.5 12.78 16.5 12.5ZM9.77 16C7.84 16 6.27 14.43 6.27 12.5C6.27 10.57 7.84 9 9.77 9C11.7 9 13.27 10.57 13.27 12.5C13.27 14.43 11.7 16 9.77 16Z"
        fill={color}
      />
    </Svg>
  );
}

export function SpeakerIcon({ size = 24, color = '#B400FF' }: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} fill="none">
      <Polygon points="4,10 8,10 13,6 13,18 8,14 4,14" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 9a4 4 0 0 1 0 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M18.5 6.5a7 7 0 0 1 0 11" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChatIcon({ size = 19, color = '#A1ACBA' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 19 23" fill="none">
      <Path
        d="M16.5 1.5H2.5C1.4 1.5 0.5 2.4 0.5 3.5V22.5L4.5 18.5H16.5C17.6 18.5 18.5 17.6 18.5 16.5V3.5C18.5 2.4 17.6 1.5 16.5 1.5Z"
        fill={color}
      />
    </Svg>
  );
}

export function VaultIcon({ size = 15, color = '#A1ACBA' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 15 24" fill="none">
      <Path
        d="M12.5 8.5H11.5V6.5C11.5 3.74 9.26 1.5 6.5 1.5C3.74 1.5 1.5 3.74 1.5 6.5V8.5H0.5C0.224 8.5 0 8.724 0 9V23C0 23.276 0.224 23.5 0.5 23.5H12.5C12.776 23.5 13 23.276 13 23V9C13 8.724 12.776 8.5 12.5 8.5ZM7 18C7 18.276 6.776 18.5 6.5 18.5C6.224 18.5 6 18.276 6 18V14C6 13.724 6.224 13.5 6.5 13.5C6.776 13.5 7 13.724 7 14V18ZM9.5 8.5H3.5V6.5C3.5 4.843 4.843 3.5 6.5 3.5C8.157 3.5 9.5 4.843 9.5 6.5V8.5Z"
        fill={color}
      />
    </Svg>
  );
}

export function UpgradeIcon({ size = 18, color = '#81ECFF' }: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} fill="none">
      <Path
        d="M12 3l3 6 6 .9-4.4 4.3 1 6.1L12 17l-5.6 3.3 1-6.1L3 9.9 9 9l3-6Z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function BoltIcon({ size = 12, color = '#81ECFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 16" fill="none">
      <Path d="M7 0L0 9H5L4 16L11 7H6L7 0Z" fill={color} />
    </Svg>
  );
}

export function LockIcon({ size = 12, color = '#81ECFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 13 16" fill="none">
      <Path
        d="M10.5 5.5H9.5V3.5C9.5 1.57 7.93 0 6 0C4.07 0 2.5 1.57 2.5 3.5V5.5H1.5C0.67 5.5 0 6.17 0 7V14C0 14.83 0.67 15.5 1.5 15.5H10.5C11.33 15.5 12 14.83 12 14V7C12 6.17 11.33 5.5 10.5 5.5ZM6 11.5C5.17 11.5 4.5 10.83 4.5 10C4.5 9.17 5.17 8.5 6 8.5C6.83 8.5 7.5 9.17 7.5 10C7.5 10.83 6.83 11.5 6 11.5ZM8 5.5H4V3.5C4 2.4 4.9 1.5 6 1.5C7.1 1.5 8 2.4 8 3.5V5.5Z"
        fill={color}
      />
    </Svg>
  );
}

export function UserIcon({ size = 16, color = '#81ECFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M8 8C9.65685 8 11 6.65685 11 5C11 3.34315 9.65685 2 8 2C6.34315 2 5 3.34315 5 5C5 6.65685 6.34315 8 8 8Z"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
      />
      <Path
        d="M3 14C3 11.2386 5.23858 9 8 9C10.7614 9 13 11.2386 13 14"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
