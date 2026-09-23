import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrganizationSchema } from '../lib/structuredData';

test('publishes every verified social profile in the organization schema', () => {
  assert.deepEqual(buildOrganizationSchema().sameAs, [
    'https://x.com/Voidix_tech',
    'https://www.linkedin.com/company/voidix-tech',
    'https://github.com/Voidix-tech',
    'https://www.facebook.com/Voidix.tech/',
  ]);
});

test('publishes the verified public email in the organization schema', () => {
  assert.equal(buildOrganizationSchema().email, 'info@voidix.tech');
});

test('publishes the verified public telephone in the organization schema', () => {
  assert.equal(buildOrganizationSchema().telephone, '+13073179422');
});

test('publishes the raster brand icon as the organization logo', () => {
  assert.equal(buildOrganizationSchema().logo, 'https://www.voidix.tech/icon.png');
});
