import { Pressable, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/types";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { Notice } from "@/components/molecules/Notice";
import { Choice } from "@/components/molecules/Choice";
import { investmentPlatforms, investmentRanges } from "@/services/earlyAccess";
import colors from "@/theme/colors.json";
import { useEarlyAccessController } from "./useEarlyAccessController";

export function RequestAccessScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "RequestAccess">) {
  const c = useEarlyAccessController();
  const pending = c.status === "pending";
  return (
    <Screen>
      {c.status === "success" ? (
        <View className="grow justify-center gap-6">
          <Typography variant="title">Request complete</Typography>
          <Typography>Thank you for helping shape Gizu.</Typography>
          <Button label="Done" onPress={() => navigation.goBack()} />
        </View>
      ) : (
        <>
          <Button
            label="Close request access"
            variant="quiet"
            onPress={() => navigation.goBack()}
          />
          <Typography variant="title">Request early access</Typography>
          <Typography>Help us shape Gizu. Tell us about your interests.</Typography>
          <Typography variant="row">Where should we send your invitation?</Typography>
          <TextInput
            accessibilityLabel="Email address"
            placeholder="Email address"
            placeholderTextColor={colors.muted}
            value={c.email}
            onChangeText={c.setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
            editable={!pending}
            className="min-h-12 rounded-2xl border border-border bg-surface px-4 py-3 text-base text-text"
          />
          <Typography variant="row">How much would you consider investing through Gizu?</Typography>
          <Typography variant="caption">Select one, not a commitment.</Typography>
          <View className="flex-row flex-wrap gap-2">
            {investmentRanges.map((label) => (
              <View key={label} className="w-full grow xs:w-[47%]">
                <Choice
                  label={label}
                  selected={c.amount === label}
                  disabled={pending}
                  onPress={() => c.setAmount(label)}
                />
              </View>
            ))}
          </View>
          <Typography variant="row">Which platforms do you use to invest or earn yield?</Typography>
          <Typography variant="caption">Select all that apply.</Typography>
          <View className="flex-row flex-wrap gap-2">
            {investmentPlatforms.map((label) => (
              <Pressable
                key={label}
                accessibilityRole="checkbox"
                accessibilityLabel={label}
                accessibilityState={{ checked: c.platforms.includes(label), disabled: pending }}
                disabled={pending}
                onPress={() => c.togglePlatform(label)}
                className={`min-h-12 justify-center rounded-full border px-4 py-3 ${c.platforms.includes(label) ? "border-transparent bg-accent/10" : "border-border"}`}
              >
                <Typography variant={c.platforms.includes(label) ? "label" : "caption"}>
                  {label}
                </Typography>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Other platform"
            placeholder="Other platform"
            placeholderTextColor={colors.muted}
            value={c.other}
            onChangeText={c.setOther}
            maxLength={200}
            editable={!pending}
            className="min-h-12 rounded-2xl border border-border bg-surface px-4 py-3 text-base text-text"
          />
          {c.error && <Notice error message={c.error} />}
          <Button
            label={pending ? "Sending request" : "Request access"}
            loading={pending}
            onPress={() => void c.submit()}
          />
        </>
      )}
    </Screen>
  );
}
