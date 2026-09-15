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
          artist="歌手"
          title="歌曲"
          visible
          onClose={jest.fn()}
          onConfirm={onConfirm}
        />,
      );
    });
    let confirm = tree!.root.findByProps({
      accessibilityLabel: '同意并翻译',
    }) as unknown as { props: { disabled: boolean; onPress: () => void } };
    expect(confirm.props.disabled).toBe(true);
    for (const label of [
      '将发送当前完整同步歌词',
      '将发送歌曲标题',
      '将发送歌手名称',
      '此请求可能产生 API 费用',
      '确认前取消不会发送请求；切歌或关闭时可取消',
      '失败不会替换或保存当前译文',
    ]) {
      await act(async () => {
        tree!.root.findByProps({ accessibilityLabel: label }).props.onPress();
      });
    }
    confirm = tree!.root.findByProps({
      accessibilityLabel: '同意并翻译',
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
