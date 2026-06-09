import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../platform.js';

test('detectPlatform: instagram variants', () => {
  assert.equal(detectPlatform('https://www.instagram.com/p/ABC123/'), 'instagram');
  assert.equal(detectPlatform('https://instagram.com/reel/XYZ/'), 'instagram');
});

test('detectPlatform: tiktok variants', () => {
  assert.equal(detectPlatform('https://www.tiktok.com/@user/video/123'), 'tiktok');
  assert.equal(detectPlatform('https://vm.tiktok.com/ABCDEF/'), 'tiktok');
});

test('detectPlatform: open web', () => {
  assert.equal(detectPlatform('https://example.com/article'), 'web');
  assert.equal(detectPlatform('https://someblog.org/post/1'), 'web');
});

test('detectPlatform: rejects a non-URL', () => {
  assert.throws(() => detectPlatform('not a url'), /not a valid URL/);
});

test('detectPlatform: a look-alike host is not instagram', () => {
  assert.equal(detectPlatform('https://instagram.com.evil.example/p/1'), 'web');
});
