import React, { useCallback, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '@/auth/AuthContext';
import { ToastProvider, useToast } from '@/components/Toast';
import { uploadManager } from '@/upload/manager';
import { colors } from '@/theme';

// Keep the native splash visible until our animated splash (app/index.tsx) mounts.
void SplashScreen.preventAutoHideAsync();

/** Bridges upload-queue events into snackbar toasts. */
function QueueToasts() {
  const toast = useToast();
  useEffect(() => {
    return uploadManager.subscribeEvents((event) => {
      const tone = event.kind === 'done' ? 'success' : event.kind === 'rejected' ? 'danger' : 'warning';
      toast.show(event.message, tone);
    });
  }, [toast]);
  return null;
}

export default function RootLayout() {
  useEffect(() => {
    // Boot the offline upload pipeline: foreground + connectivity triggers.
    uploadManager.start();
  }, []);

  const onLayout = useCallback(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root} onLayout={onLayout}>
      <SafeAreaProvider>
        <AuthProvider>
          <ToastProvider>
            <StatusBar style="light" backgroundColor={colors.bg} />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'fade',
              }}
            >
              {/* The walkthrough slides up over the splash/login flow. */}
              <Stack.Screen name="walkthrough" options={{ animation: 'slide_from_bottom' }} />
            </Stack>
            <QueueToasts />
          </ToastProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
