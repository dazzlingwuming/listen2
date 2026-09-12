import type { NavigatorScreenParams } from '@react-navigation/native';
import type { SourceId, Track } from '../types/music';

export type TabParamList = {
  My: undefined;
  Discover: undefined;
  Search: { sourceId?: SourceId; query?: string } | undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<TabParamList> | undefined;
  PlaylistDetail: { sourceId: SourceId; title: string; tracks?: Track[] };
  Player: undefined;
};
