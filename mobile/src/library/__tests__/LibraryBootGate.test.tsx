import React from 'react';
import { View } from 'react-native';
import renderer, { act } from 'react-test-renderer';

const mockDispatch = jest.fn();
const mockGetMigrationStatus = jest.fn();

jest.mock('../../store', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (state: unknown) => unknown) => selector({
    library: {
      hydrated: false,
      hydrationPending: false,
      hydrationError: 'INVALID_RESPONSE',
    },
  }),
}));
jest.mock('../libraryClient', () => ({
  LibraryClientError: class LibraryClientError extends Error {},
  libraryClient: {
    getMigrationStatus: mockGetMigrationStatus,
    getSnapshot: jest.fn(),
  },
}));
jest.mock('../legacyMigration', () => ({
  migrateKnownLegacyLibrary: jest.fn(),
}));
jest.mock('../../history/history', () => ({
  history: { recentTracks: jest.fn() },
}));

import { LibraryBootGate } from '../LibraryBootGate';

describe('LibraryBootGate degraded startup', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockGetMigrationStatus.mockRejectedValue(new Error('native failure'));
  });

  it('keeps the application usable when library recovery fails', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LibraryBootGate><View accessibilityLabel="app-shell" /></LibraryBootGate>);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ accessibilityLabel: 'app-shell' })).toBeDefined();
    expect(tree.root.findByProps({ accessibilityRole: 'alert' }).props.children).toBeDefined();
    expect(tree.root.findByProps({ accessibilityRole: 'button' })).toBeDefined();
    expect(tree.root.findAllByProps({ accessibilityLabel: '正在加载音乐库' })).toHaveLength(0);
  });
});
