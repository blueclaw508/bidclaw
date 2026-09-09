import assert from 'node:assert/strict';
import { lockBodyScroll } from '../src/lib/bodyScrollLock.ts';
for (const original of ['', 'auto', 'scroll']) {
  const body={style:{overflow:original}};
  const closeA=lockBodyScroll(body),closeB=lockBodyScroll(body);
  closeA();
  assert.equal(body.style.overflow,'hidden','Closing the first dialog must preserve the second lock');
  closeB();
  assert.equal(body.style.overflow,original,'Last close restores scrolling instead of stale hidden');
  closeA(); closeB();
  const closeC=lockBodyScroll(body);
  closeC();
  assert.equal(body.style.overflow,original,'Repeated cleanup is harmless');
}
const body={style:{overflow:''}};
const closeA=lockBodyScroll(body),closeB=lockBodyScroll(body);
closeB(); closeA();
assert.equal(body.style.overflow,'','Reverse close order also restores scrolling');
console.log('PASS: overlapping dialogs, both close orders, original style restoration and idempotent cleanup');
