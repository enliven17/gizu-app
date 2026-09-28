import { Component, type PropsWithChildren } from "react";
import { Text, View } from "react-native";
import { Button } from "@/components/atoms/Button";

export class ErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <View className="flex-1 justify-center gap-6 bg-ink p-8">
          <Text accessibilityRole="alert" className="font-sans text-xl text-text">
            Something went wrong. Please try again.
          </Text>
          <Button label="Try again" onPress={() => this.setState({ failed: false })} />
        </View>
      );
    }
    return this.props.children;
  }
}
