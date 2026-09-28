import type { PropsWithChildren } from "react";
import { TextInput, View, type TextStyle } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Check, X } from "lucide-react-native";
import Animated, { ZoomIn } from "react-native-reanimated";
import type { RootStackParamList } from "@/navigation/types";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { IconButton } from "@/components/atoms/IconButton";
import { Notice } from "@/components/molecules/Notice";
import { investmentPlatforms, investmentRanges } from "@/services/earlyAccess";
import colors from "@/theme/colors.json";
import { reduceMotion, springs } from "@/theme/motion";
import { RequestOption } from "./components/RequestOption";
import { useEarlyAccessController } from "./useEarlyAccessController";

// Frontend `text-[13px] leading-relaxed text-white/45` supporting copy.
const hint: TextStyle = { fontSize: 13, lineHeight: 20, color: colors.fg["45"] };

// Frontend `glass-soft` fields with a neon caret.
const field = "rounded-2xl border border-borderSoft bg-glassSoft px-5 text-text";

// Frontend success tile: scale 0.4 → 1 on a 220/18 spring.
const tileEntering = ZoomIn.springify()
  .stiffness(springs.check.stiffness ?? 220)
  .damping(springs.check.damping ?? 18)
  .withInitialValues({ transform: [{ scale: 0.4 }] })
  .reduceMotion(reduceMotion);

function Sheet({ children }: PropsWithChildren) {
  // Frontend sheet: `glass rounded-t-[36px] px-5 pb-8 pt-5`, full-bleed in the modal.
  return (
    <View className="-mx-5 -mb-4 grow gap-7 rounded-t-sheet border border-b-0 border-glassBorder bg-glass px-5 pb-8 pt-5">
      {children}
    </View>
  );
}

function Question({ title, hint }: { title: string; hint?: string }) {
  return (
    <View className="gap-1">
      <Typography variant="rowTitle">{title}</Typography>
      {hint && <Typography variant="eyebrow">{hint}</Typography>}
    </View>
  );
}

export function RequestAccessScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "RequestAccess">) {
  const c = useEarlyAccessController();
  const pending = c.status === "pending";
  if (c.status === "success")
    return (
      <Screen>
        <Sheet>
          <View className="grow items-center justify-center gap-6">
            <Animated.View
              entering={tileEntering}
              className="h-20 w-20 items-center justify-center rounded-[28px] border border-glassBorder bg-glass"
            >
              <Check size={38} strokeWidth={2.2} color={colors.neon.DEFAULT} />
            </Animated.View>
            <View className="items-center gap-2">
              <Typography variant="heading" className="text-center">
                Request complete
              </Typography>
              <Typography className="text-center" style={{ ...hint, fontSize: 14 }}>
                Thank you for helping shape Gizu.
              </Typography>
            </View>
          </View>
          <Button label="Done" onPress={() => navigation.goBack()} />
        </Sheet>
      </Screen>
    );
  return (
    <Screen>
      <Sheet>
        <View className="flex-row items-start justify-between gap-4">
          <View className="shrink gap-2">
            <Typography variant="heading">Request early access</Typography>
            <Typography className="max-w-[360px]" style={hint}>
              Help us shape Gizu. Tell us about your interests.
            </Typography>
          </View>
          <IconButton icon={X} label="Close request access" onPress={() => navigation.goBack()} />
        </View>
        <View className="gap-3">
          <Question title="Where should we send your invitation?" />
          <TextInput
            accessibilityLabel="Email address"
            placeholder="Email address"
            placeholderTextColor={colors.fg["35"]}
            selectionColor={colors.neon.DEFAULT}
            cursorColor={colors.neon.DEFAULT}
            value={c.email}
            onChangeText={c.setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            maxLength={254}
            editable={!pending}
            className={`font-sans min-h-[52px] py-4 text-[14px] ${field} ${pending ? "opacity-50" : ""}`}
          />
        </View>
        <View className="gap-3">
          <Question
            title="How much would you consider investing through Gizu?"
            hint="Select one, not a commitment."
          />
          <View className="flex-row flex-wrap gap-2">
            {investmentRanges.map((label) => (
              <View key={label} className="w-full grow xs:w-[47%]">
                <RequestOption
                  kind="radio"
                  label={label}
                  selected={c.amount === label}
                  disabled={pending}
                  onPress={() => c.setAmount(label)}
                />
              </View>
            ))}
          </View>
        </View>
        <View className="gap-3">
          <Question title="Which platforms do you use to invest or earn yield?" />
          <View className="flex-row flex-wrap gap-2">
            {investmentPlatforms.map((label) => (
              <RequestOption
                key={label}
                kind="checkbox"
                label={label}
                selected={c.platforms.includes(label)}
                disabled={pending}
                onPress={() => c.togglePlatform(label)}
              />
            ))}
          </View>
          <TextInput
            accessibilityLabel="Other platform"
            placeholder="Other platform"
            placeholderTextColor={colors.fg["35"]}
            selectionColor={colors.neon.DEFAULT}
            cursorColor={colors.neon.DEFAULT}
            value={c.other}
            onChangeText={c.setOther}
            maxLength={200}
            editable={!pending}
            className={`font-sans min-h-12 py-3.5 text-[13px] ${field} ${pending ? "opacity-50" : ""}`}
          />
        </View>
        {c.error && <Notice error message={c.error} />}
        <Button
          label={pending ? "Sending request" : "Request access"}
          loading={pending}
          onPress={() => void c.submit()}
        />
      </Sheet>
    </Screen>
  );
}
