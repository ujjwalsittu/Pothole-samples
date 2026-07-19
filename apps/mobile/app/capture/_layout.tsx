import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '@/theme';

export default function CaptureLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    >
      {/* The upload queue slides up like a sheet. */}
      <Stack.Screen name="queue" options={{ animation: 'slide_from_bottom' }} />
    </Stack>
  );
}
