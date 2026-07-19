import React from 'react';
import { Tabs } from 'expo-router';
import { TabIcon } from '@/components/TabIcon';
import { useAuth } from '@/auth/AuthContext';
import { colors, font } from '@/theme';

export default function TabsLayout() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

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
          tabBarIcon: ({ color }) => <TabIcon name="earnings" color={color} />,
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
