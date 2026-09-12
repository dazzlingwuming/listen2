import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { MiniPlayer } from '../components/MiniPlayer';
import { MyMusicScreen } from '../screens/MyMusicScreen';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PlaylistDetailScreen } from '../screens/PlaylistDetailScreen';
import { PlayerScreen } from '../screens/PlayerScreen';
import { colors, spacing } from '../theme';
import type { RootStackParamList, TabParamList } from './types';

const Tabs = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const tabLabels: Record<keyof TabParamList, string> = {
  My: '我的',
  Discover: '发现',
  Search: '搜索',
  Settings: '设置',
};
const tabMarks: Record<keyof TabParamList, string> = {
  My: '♬',
  Discover: '◈',
  Search: '⌕',
  Settings: '⚙',
};

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={MobileTabBar}
    >
      <Tabs.Screen component={MyMusicScreen} name="My" />
      <Tabs.Screen component={DiscoverScreen} name="Discover" />
      <Tabs.Screen component={SearchScreen} name="Search" />
      <Tabs.Screen component={SettingsScreen} name="Settings" />
    </Tabs.Navigator>
  );
}

function MobileTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      <MiniPlayer />
      <View accessibilityRole="tablist" style={styles.tabs}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const name = route.name as keyof TabParamList;
          return (
            <Pressable
              accessibilityLabel={tabLabels[name]}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              key={route.key}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented)
                  navigation.navigate(route.name, route.params);
              }}
              style={styles.tab}
            >
              <Text style={[styles.mark, focused && styles.selected]}>
                {tabMarks[name]}
              </Text>
              <Text style={[styles.label, focused && styles.selected]}>
                {tabLabels[name]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function RootNavigator() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen component={MainTabs} name="MainTabs" />
          <Stack.Screen
            component={PlaylistDetailScreen}
            name="PlaylistDetail"
          />
          <Stack.Screen
            component={PlayerScreen}
            name="Player"
            options={{ animation: 'slide_from_bottom' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabs: { height: 64, flexDirection: 'row' },
  tab: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  mark: { color: colors.muted, fontSize: 20, lineHeight: 23 },
  label: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  selected: { color: colors.accent, fontWeight: '600' },
});
