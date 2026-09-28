package io.gizu.storedwallet

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Build
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Presentation-only styling for native wallet ceremonies. It owns no behavior: callers keep click
 * handling, overlay protection and window flags. Every button it creates filters obscured touches.
 */
internal object NativeStyle {
  val ink = Color.parseColor("#050706")
  val surface = Color.parseColor("#0b100d")
  val glass = Color.argb(184, 14, 19, 16)
  val glassBorder = Color.argb(14, 255, 255, 255)
  val glassSoft = Color.argb(8, 255, 255, 255)
  val glassPressed = Color.argb(20, 255, 255, 255)
  val primaryText = Color.parseColor("#dfe8e3")
  val secondary = Color.argb(140, 255, 255, 255)
  val disabledText = Color.argb(89, 255, 255, 255)
  val neon = Color.parseColor("#31c47e")
  val neonPressed = Color.parseColor("#238a5a")
  val neonDeep = Color.parseColor("#123423")
  val ctaText = Color.parseColor("#05140d")
  val danger = Color.parseColor("#ff9b9b")
  val dangerBorder = Color.argb(71, 255, 155, 155)

  fun dp(context: Context, value: Int) = (value * context.resources.displayMetrics.density).toInt()

  /** Loads the app's bundled Helvetica Neue weight, falling back to system sans. */
  fun font(context: Context, medium: Boolean): Typeface {
    val fallback =
      Typeface.create(if (medium) "sans-serif-medium" else "sans-serif", Typeface.NORMAL)
    if (Build.VERSION.SDK_INT < 26) return fallback
    return try {
      val name = if (medium) "helvetica_neue_500" else "helvetica_neue_400"
      val id = context.resources.getIdentifier(name, "font", context.packageName)
      if (id == 0) fallback else context.resources.getFont(id)
    } catch (_: Exception) {
      fallback
    }
  }

  fun rounded(context: Context, color: Int, radiusDp: Int, stroke: Int? = null): Drawable =
    GradientDrawable().apply {
      setColor(color)
      cornerRadius = dp(context, radiusDp).toFloat()
      if (stroke != null) setStroke(dp(context, 1), stroke)
    }

  /** Glass card: rgba(14,19,16,.72) with a 1dp white 5.5% border and 24dp corners. */
  fun card(context: Context) = rounded(context, glass, 24, glassBorder)

  fun title(context: Context, value: String, size: Float = 24f) =
    TextView(context).apply {
      text = value
      textSize = size
      setTextColor(primaryText)
      typeface = font(context, true)
      setLineSpacing(dp(context, 2).toFloat(), 1f)
      if (Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true
    }

  fun body(context: Context, value: String, color: Int = secondary) =
    TextView(context).apply {
      text = value
      textSize = 15f
      setTextColor(color)
      typeface = font(context, false)
      setLineSpacing(dp(context, 4).toFloat(), 1f)
    }

  fun button(context: Context, label: String, primary: Boolean) =
    Button(context).apply {
      text = label
      isAllCaps = false
      textSize = 16f
      typeface = font(context, true)
      minHeight = dp(context, 56)
      minimumHeight = dp(context, 56)
      gravity = Gravity.CENTER
      setPadding(dp(context, 20), dp(context, 14), dp(context, 20), dp(context, 14))
      stateListAnimator = null
      elevation = 0f
      backgroundTintList = null
      val idle = if (primary) neon else glass
      val pressed = if (primary) neonPressed else glassPressed
      background =
        StateListDrawable().apply {
          addState(
            intArrayOf(-android.R.attr.state_enabled),
            rounded(context, if (primary) neonDeep else glass, 16, glassBorder),
          )
          addState(
            intArrayOf(android.R.attr.state_pressed),
            rounded(context, pressed, 16, if (primary) null else glassBorder),
          )
          addState(intArrayOf(), rounded(context, idle, 16, if (primary) null else glassBorder))
        }
      setTextColor(
        ColorStateList(
          arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
          intArrayOf(disabledText, if (primary) ctaText else primaryText),
        )
      )
      // Security: approval/cancel input is ignored while another window overlays this one.
      filterTouchesWhenObscured = true
    }

  fun fullWidth(context: Context, topMarginDp: Int = 0) =
    LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
      .apply { topMargin = dp(context, topMarginDp) }
}
