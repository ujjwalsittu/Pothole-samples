import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { TabIcon } from '@/components/TabIcon';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/auth/AuthContext';
import {
  configureForegroundNotifications,
  registerForPushNotifications,
} from '@/push/register';
import { checkForModelUpdate } from '@/detection/model-updater';
import { colors, font } from '@/theme';

export default function TabsLayout() {
  const { profile } = useAuth();
  const toast = useToast();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

  // Push: register once the user reaches the tabs (i.e. after approval) and
  // surface foreground notifications as in-app toasts. All failures are silent.
  useEffect(() => {
    configureForegroundNotifications();
    void registerForPushNotifications();
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const { title, body } = notification.request.content;
      const message = [title, body].filter(Boolean).join(' — ');
      if (message) toast.show(message, 'info');
    });
    // OTA detection-model check: fire-and-forget shortly after the tabs mount.
    const modelTimer = setTimeout(() => {
      void checkForModelUpdate().then((result) => {
        if (result) toast.show(`Road-detection model v${result.version} installed`, 'success');
      });
    }, 3000);
    return () => {
      sub.remove();
      clearTimeout(modelTimer);
    };
  }, [toast]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: font.tiny, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <TabIcon name="dashboard" color={color} />,
        }}
      />
      <Tabs.Screen
        name="samples"
        options={{
          title: 'Samples',
          tabBarIcon: ({ color }) => <TabIcon name="samples" color={color} />,
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          // Money surfaces exist only for admin-assigned collectors.
          href: profile?.isCollector ? '/(tabs)/earnings' : null,
          tabBarIcon: ({ color }) => <TabIcon name="earnings" color={color} />,
        }}
      />
      <Tabs.Screen
        name="ranks"
        options={{
          title: 'Ranks',
          tabBarIcon: ({ color }) => <TabIcon name="ranks" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TabIcon name="profile" color={color} />,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          // Hidden entirely unless the logged-in user is an admin/owner.
          href: isAdmin ? '/(tabs)/admin' : null,
          tabBarIcon: ({ color }) => <TabIcon name="admin" color={color} />,
        }}
      />
    </Tabs>
  );
}
