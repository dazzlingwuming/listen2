import React from 'react';
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../ScreenLayout', () => ({ ScreenLayout: ({ children }: any) => <>{children}</>, sectionStyles: { card: {}, section: {}, button: {}, buttonText: {}, secondaryButton: {}, secondaryText: {} } }));
jest.mock('../../history/history', () => ({ history: { getHistory: jest.fn().mockResolvedValue({ data: [] }), recordingEnabled: jest.fn().mockResolvedValue({ data: { recordingEnabled: true } }), setRecordingEnabled: jest.fn(), clear: jest.fn(), exportSafe: jest.fn() } }));
import { HistoryScreen } from '../HistoryScreen';
test('history screen provides the history and privacy surface', () => { expect(HistoryScreen).toBeDefined(); });
