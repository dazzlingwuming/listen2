const fs = require('fs');
const path = require('path');

describe('native DeepSeek wiring', () => {
  it('constructs the policy input and calls the client with the exact semantic signature', () => {
    const module = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../android/app/src/main/java/com/listen2mobile/deepseek/DeepSeekModule.kt',
      ),
      'utf8',
    );
    expect(module).toContain('val input = DeepSeekPolicy.Input(');
    expect(module).toContain('lyricText(request, "lyric")');
    expect(module).toContain('val value = client.translate(');
    expect(module).toContain('text(request, "operationId", 64),');
    expect(module).toContain('input,');
    expect(module).not.toContain(
      'client.translate(text(request, "operationId", 64), text(request, "provider", 16)',
    );
  });
});
