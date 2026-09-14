import React from 'react';
import { act, create } from 'react-test-renderer';
import { DeepSeekConsentSheet } from '../../components/DeepSeekConsentSheet';

describe('DeepSeek consent flow', () => {
  it('does not allow a network confirmation until all six disclosures are checked', async () => {
    const onConfirm = jest.fn();
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <DeepSeekConsentSheet
          visible
          onClose={jest.fn()}
          onConfirm={onConfirm}
        />,
      );
    });
    let confirm = tree!.root.findByProps({
      accessibilityLabel: '确认使用 DeepSeek 翻译',
    }) as unknown as { props: { disabled: boolean; onPress: () => void } };
    expect(confirm.props.disabled).toBe(true);
    for (const label of [
      '将发送当前完整同步歌词',
      '将发送歌曲标题',
      '将发送歌手名称',
      '此请求可能产生 API 费用',
      '切歌或关闭时可取消请求',
      '失败时会保留原歌词，不会伪造译文',
    ]) {
      await act(async () => {
        tree!.root.findByProps({ accessibilityLabel: label }).props.onPress();
      });
    }
    confirm = tree!.root.findByProps({
      accessibilityLabel: '确认使用 DeepSeek 翻译',
    }) as unknown as { props: { disabled: boolean; onPress: () => void } };
    expect(confirm.props.disabled).toBe(false);
    await act(async () => confirm.props.onPress());
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        lyrics: true,
        possibleCost: true,
        acceptedAtEpochMs: expect.any(Number),
      }),
    );
  });
});
