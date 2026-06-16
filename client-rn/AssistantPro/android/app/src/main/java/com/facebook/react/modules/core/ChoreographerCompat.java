package com.facebook.react.modules.core;

import android.view.Choreographer;

/**
 * Shim for ChoreographerCompat which was removed in React Native 0.76+.
 * react-native-screens still references this class; this shim delegates to
 * android.view.Choreographer.FrameCallback so the build succeeds.
 */
public class ChoreographerCompat {

  public abstract static class FrameCallback implements Choreographer.FrameCallback {
    // doFrame(long frameTimeNanos) is declared by Choreographer.FrameCallback;
    // subclasses override it directly — no extra indirection needed.
  }
}
