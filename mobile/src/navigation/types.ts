import type { NavigatorScreenParams } from '@react-navigation/native';
import type { PlayableTrack, SourceId } from '../types/music';

export type TabParamList = {
  My: undefined;
  Discover: undefined;
  Search: { sourceId?: SourceId; query?: string } | undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<TabParamList> | undefined;
  PlaylistDetail: {
    /** Local collections use this label; remote provider calls use SourceId. */
    sourceId: SourceId | 'local';
    title: string;
    tracks?: PlayableTrack[];
    /** A semantic provider playlist id, never a URL or a caller-provided route. */
    remotePlaylistId?: string;
    libraryPlaylistId?: string;
    libraryCollection?: 'favorites' | 'recent' | 'local';
  };
  Player: undefined;
};
