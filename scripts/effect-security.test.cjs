const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('Effect rejects hostile template input without blocking the process', () => {
  // Bound the subprocess so a vulnerable dependency cannot hang the test runner.
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { Schema } = require('effect');
    const schema = Schema.TemplateLiteral(
      Schema.String, ':', Schema.String, ':', Schema.String, 'X'
    );
    const decode = Schema.decodeUnknownSync(schema);
    assert.equal(decode('a:b:cX'), 'a:b:cX');
    assert.throws(() => decode(':'.repeat(20000)));
    console.log('Rejected hostile template input');
  `], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Rejected hostile template input/);
});
