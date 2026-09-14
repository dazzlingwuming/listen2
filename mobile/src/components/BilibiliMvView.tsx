import React from 'react';
import { requireNativeComponent, type ViewProps } from 'react-native';

/** Native receives only the opaque handle. It cannot be pointed at a JS supplied URL. */
type Props = ViewProps & { handle?: string };
const NativeBilibiliMvView = requireNativeComponent<Props>(
  'Listen2BilibiliMvView',
);

export function BilibiliMvView({ handle, ...props }: Props) {
  return <NativeBilibiliMvView {...props} handle={handle} />;
}
