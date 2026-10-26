/* eslint-env node */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let factory;
let rejectDetail;
const scope = { $on() {}, $watch() {}, $evalAsync(fn) { fn(); } };
const timeout = () => ({});
timeout.cancel = () => {};
const context = {
  angular: { module: () => ({ controller: (name, args) => { factory = args[args.length - 1]; } }) },
  window: { Listen2AndroidHttpAdapter: { isAvailable: () => true } },
  i18next: { t: key => key },
  sourceList: [{ name: 'bilibili' }],
  MediaService: { getVideoContext: () => ({
    success() { return this; },
    error(fn) { rejectDetail = fn; return this; },
    cancel() {},
  }) },
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/controller/instant_search.js'), 'utf8'), context);
factory(scope, timeout, { $broadcast() {} });
const track = { id: 'bitrack_v_BV1xx411c7mD', source: 'bilibili', title: 'Public track' };
for (const error of [
  { code: 'android-rpc-provider-status', status: 412 },
  { kind: 'provider-status', status: 'android-rpc-provider-status' },
]) {
  scope.openBilibiliDetail(track);
  rejectDetail(error);
  assert.strictEqual(scope.bilibiliDetail.state, 'error');
  assert.match(scope.bilibiliDetail.message, /B 站暂时拒绝请求/);
  assert.doesNotMatch(scope.bilibiliDetail.message, /无效|无法识别|已失效/);
}
scope.openBilibiliDetail(track);
rejectDetail({ code: 'android-rpc-timeout', status: 0 });
assert.match(scope.bilibiliDetail.message, /超时/);
scope.openBilibiliDetail(track);
rejectDetail({ code: 'android-rpc-permission', status: 403 });
assert.match(scope.bilibiliDetail.message, /登录 B 站/);
console.log('Android Bilibili detail failure messages passed');
