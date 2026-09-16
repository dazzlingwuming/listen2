import React from 'react';
import { View } from 'react-native';
import renderer, { act } from 'react-test-renderer';

const mockDispatch = jest.fn();

jest.mock('../../store', () => ({
  useAppDispatch: jest.fn(),
  useAppSelector: (selector: (state: unknown) => unknown) => selector({
    library: {
      hydrated: false,
      hydrationPending: false,
      hydrationError: 'INVALID_RESPONSE',
    },
  }),
}));
jest.mock('../libraryClient', () => ({
  LibraryClientError: class LibraryClientError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  libraryClient: {
    getMigrationStatus: jest.fn(),
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
import { useAppDispatch } from '../../store';
import { LibraryClientError, libraryClient } from '../libraryClient';
import { migrateKnownLegacyLibrary } from '../legacyMigration';
import { history } from '../../history/history';

const mockUseAppDispatch = useAppDispatch as unknown as jest.Mock;
const mockGetMigrationStatus = libraryClient.getMigrationStatus as jest.Mock;
const mockGetSnapshot = libraryClient.getSnapshot as jest.Mock;
const mockMigrateKnownLegacyLibrary = migrateKnownLegacyLibrary as jest.Mock;
const mockRecentTracks = history.recentTracks as jest.Mock;

describe('LibraryBootGate degraded startup', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockUseAppDispatch.mockReset();
    mockUseAppDispatch.mockReturnValue(mockDispatch);
    mockGetMigrationStatus.mockReset();
    mockGetSnapshot.mockReset();
    mockMigrateKnownLegacyLibrary.mockReset();
    mockRecentTracks.mockReset();
    mockGetMigrationStatus.mockRejectedValue(new Error('native failure'));
    mockGetSnapshot.mockRejectedValue(new Error('snapshot failure'));
    mockMigrateKnownLegacyLibrary.mockResolvedValue({ status: 'no-legacy' });
    mockRecentTracks.mockResolvedValue([]);
  });

  async function renderGate() {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LibraryBootGate><View accessibilityLabel="app-shell" /></LibraryBootGate>);
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    return tree;
  }

  it('hydrates from the Room snapshot after a retryable legacy migration result', async () => {
    const snapshot = { revision: 4 };
    mockGetMigrationStatus.mockResolvedValue({ phase: 'failed' });
    mockMigrateKnownLegacyLibrary.mockResolvedValue({ status: 'retryable' });
    mockGetSnapshot.mockResolvedValue(snapshot);

    const tree = await renderGate();

    expect(mockMigrateKnownLegacyLibrary).toHaveBeenCalledWith(expect.stringMatching(/^boot_/));
    expect(mockGetSnapshot).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'library/hydrationSucceeded',
      payload: snapshot,
    }));
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'library/hydrationFailed' }));
    expect(tree.root.findAllByProps({ accessibilityRole: 'alert' })).toHaveLength(0);
  });

  it('hydrates from the Room snapshot when migration status is unavailable', async () => {
    const snapshot = { revision: 5 };
    mockGetMigrationStatus.mockRejectedValue(new Error('status unavailable'));
    mockGetSnapshot.mockResolvedValue(snapshot);

    const tree = await renderGate();

    expect(mockMigrateKnownLegacyLibrary).not.toHaveBeenCalled();
    expect(mockGetSnapshot).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'library/hydrationSucceeded',
      payload: snapshot,
    }));
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'library/hydrationFailed' }));
    expect(tree.root.findAllByProps({ accessibilityRole: 'alert' })).toHaveLength(0);
  });

  it('keeps the application usable when library recovery fails', async () => {
    const tree = await renderGate();

    expect(tree.root.findByProps({ accessibilityLabel: 'app-shell' })).toBeDefined();
    expect(tree.root.findByProps({ accessibilityRole: 'alert' }).props.children).toBeDefined();
    expect(tree.root.findByProps({ accessibilityRole: 'button' })).toBeDefined();
    expect(tree.root.findAllByProps({ accessibilityLabel: '正在加载音乐库' })).toHaveLength(0);
    expect(mockGetSnapshot).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'library/hydrationFailed',
      payload: 'INVALID_RESPONSE',
    }));
  });

  it('shows the real Room snapshot error only when both status and snapshot fail', async () => {
    mockGetMigrationStatus.mockRejectedValue(new Error('status unavailable'));
    mockGetSnapshot.mockRejectedValue(new LibraryClientError('TIMEOUT'));

    const tree = await renderGate();

    expect(mockGetSnapshot).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'library/hydrationFailed',
      payload: 'TIMEOUT',
    }));
    expect(tree.root.findByProps({ accessibilityRole: 'alert' })).toBeDefined();
  });
});
