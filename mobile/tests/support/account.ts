import { screen, userEvent } from "@testing-library/react-native";
import { createPreferencesStore } from "@/storage/preferences";
export async function signInToAccount() {
  await screen.findByRole("button", { name: "Continue with passkey" });
  await userEvent.press(screen.getByRole("button", { name: "Continue with passkey" }));
  await screen.findByRole("header", { name: "Your portfolio" });
}
export async function openSettings() {
  await userEvent.press(screen.getByLabelText("Settings tab"));
  await screen.findByRole("header", { name: "Account" });
}
export function memoryPreferences() {
  const values = new Map<string, string>();
  const storage = {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  };
  return { values, storage, store: createPreferencesStore(storage) };
}
