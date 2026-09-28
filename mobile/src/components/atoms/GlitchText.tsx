import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import LottieView, { type AnimationObject } from "lottie-react-native";
import { glitchWordmark } from "@/animations/glitchWordmark";

type GlitchTextProps = {
  source?: AnimationObject;
  accessibilityLabel?: string;
  testID?: string;
  text?: string;
};

export function GlitchText({
  source = glitchWordmark,
  accessibilityLabel = "Animated Gizu glitch wordmark",
  testID = "gizu-glitch-animation",
  text,
}: GlitchTextProps) {
  const animation = useRef<LottieView>(null);
  // Stay still until the native preference has been read to avoid a motion flash.
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) animation.current?.reset();
    else animation.current?.play();
  }, [reduceMotion]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      className="h-24 items-center justify-center overflow-hidden rounded-3xl border border-border bg-ink"
    >
      {text ? (
        <Text className="font-sans text-5xl font-bold tracking-[8px] text-accent">{text}</Text>
      ) : null}
      <LottieView
        ref={animation}
        source={source}
        loop={!reduceMotion}
        resizeMode="contain"
        style={{ position: "absolute", width: "100%", height: "100%" }}
        testID={testID}
      />
    </View>
  );
}
