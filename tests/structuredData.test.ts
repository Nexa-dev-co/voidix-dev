import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrganizationSchema } from '../lib/structuredData';

test('publishes the verified LinkedIn profile in the organization schema', () => {
  assert.deepEqual(buildOrganizationSchema().sameAs, [
    'https://www.linkedin.com/company/voidix-tech',
  ]);
});

test('publishes the verified public email in the organization schema', () => {
  assert.equal(buildOrganizationSchema().email, 'info@voidix.tech');
});

test('publishes the raster brand icon as the organization logo', () => {
  assert.equal(buildOrganizationSchema().logo, 'https://www.voidix.tech/icon.png');
});
