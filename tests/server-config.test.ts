import test from 'node:test';
import assert from 'node:assert/strict';
import { roomLimitFromEnvironment } from '../server/index';

test('production room configuration accepts 64 without enabling QA',()=>{
  assert.equal(roomLimitFromEnvironment({MAX_ROOMS:'64'}),64);
  assert.equal(roomLimitFromEnvironment({MAX_ROOMS:'128'}),64);
  assert.equal(roomLimitFromEnvironment({MAX_ROOMS:'128',GAME_QA:'1'}),128);
  assert.equal(roomLimitFromEnvironment({}),4);
  assert.equal(roomLimitFromEnvironment({MAX_ROOMS:'invalid'}),4);
  assert.equal(roomLimitFromEnvironment({MAX_ROOMS:'-1'}),1);
  assert.equal(roomLimitFromEnvironment({MAX_ROOMS:'4.5'}),4);
});
