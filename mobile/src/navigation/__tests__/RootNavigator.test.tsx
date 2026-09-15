import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@react-navigation/native', () => {
  const MockReact = require('react');
  return {
    createNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: jest.fn(),
    }),
    NavigationContainer: ({ children }: { children: React.ReactNode }) =>
      MockReact.createElement(MockReact.Fragment, null, children),
  };
});

jest.mock('@react-navigation/bottom-tabs', () => {
  const MockReact = require('react');
  const InsetsContext = MockReact.createContext({
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
  });
  return {
    createBottomTabNavigator: () => ({
      Navigator: ({
        tabBar,
      }: {
        tabBar: (props: Record<string, unknown>) => React.ReactNode;
      }) =>
        MockReact.createElement(InsetsContext.Consumer, null, () =>
          tabBar({
            descriptors: {},
            insets: { bottom: 0, left: 0, right: 0, top: 0 },
            navigation: {
              emit: () => ({ defaultPrevented: false }),
              navigate: jest.fn(),
            },
            state: {
              index: 0,
              routes: [
                { key: 'my', name: 'My' },
                { key: 'discover', name: 'Discover' },
                { key: 'search', name: 'Search' },
                { key: 'settings', name: 'Settings' },
              ],
            },
          }),
        ),
      Screen: () => null,
    }),
  };
});

jest.mock('@react-navigation/native-stack', () => {
  const MockReact = require('react');
  return {
    createNativeStackNavigator: () => ({
      Navigator: ({ children }: { children: React.ReactNode }) =>
        MockReact.createElement(MockReact.Fragment, null, children),
      Screen: ({
        component: Component,
        name,
      }: {
        component: React.ComponentType;
        name: string;
      }) => (name === 'MainTabs' ? MockReact.createElement(Component) : null),
    }),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const MockReact = require('react');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      MockReact.createElement(MockReact.Fragment, null, children),
    useSafeAreaInsets: () => ({ bottom: MockReact.useState(0)[0] }),
  };
});

jest.mock('../../components/MiniPlayer', () => ({ MiniPlayer: () => null }));
jest.mock('../../library/LibraryBootGate', () => ({
  LibraryBootGate: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../bilibili/mvClient', () => ({
  bilibiliMvClient: { consumePendingRestore: jest.fn() },
}));
jest.mock('../../screens/MyMusicScreen', () => ({ MyMusicScreen: () => null }));
jest.mock('../../screens/DiscoverScreen', () => ({
  DiscoverScreen: () => null,
}));
jest.mock('../../screens/SearchScreen', () => ({ SearchScreen: () => null }));
jest.mock('../../screens/SettingsScreen', () => ({
  AccountSourcesScreen: () => null,
  SettingsScreen: () => null,
}));
jest.mock('../../screens/HistoryScreen', () => ({ HistoryScreen: () => null }));
jest.mock('../../screens/CacheLibraryScreen', () => ({
  CacheLibraryScreen: () => null,
}));
jest.mock('../../screens/PlaylistDetailScreen', () => ({
  PlaylistDetailScreen: () => null,
}));
jest.mock('../../screens/PlayerScreen', () => ({ PlayerScreen: () => null }));
jest.mock('../../screens/BilibiliDetailScreen', () => ({
  BilibiliDetailScreen: () => null,
}));
jest.mock('../../screens/BilibiliMvScreen', () => ({
  BilibiliMvScreen: () => null,
}));

import { RootNavigator } from '../RootNavigator';

describe('RootNavigator tab bar composition', () => {
  it('returns a React element from the tab bar callback before hook rendering', () => {
    let tree!: renderer.ReactTestRenderer;
    expect(() => {
      act(() => {
        tree = renderer.create(<RootNavigator />);
      });
    }).not.toThrow();
    expect(
      tree.root.findByProps({ accessibilityRole: 'tablist' }),
    ).toBeDefined();
  });
});
