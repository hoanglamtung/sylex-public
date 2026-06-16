package com.facebook.react.uimanager.drawable;

import android.content.Context;
import android.graphics.drawable.ColorDrawable;

/**
 * Shim for CSSBackgroundDrawable which was renamed to BackgroundDrawable in React Native 0.76+.
 * react-native-screens imports this class but does not use it at runtime.
 */
public class CSSBackgroundDrawable extends ColorDrawable {
  public CSSBackgroundDrawable(Context context) {
    super();
  }
}
