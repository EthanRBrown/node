'use strict';

const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const http2 = require('http2');
const fs = require('fs');
const path = require('path');
const tls = require('tls');

const ajs_data = fs.readFileSync(path.resolve(common.fixturesDir, 'a.js'),
                                 'utf8');

const {
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_STATUS
} = http2.constants;

function loadKey(keyname) {
  return fs.readFileSync(
    path.join(common.fixturesDir, 'keys', keyname), 'binary');
}

const key = loadKey('agent8-key.pem');
const cert = loadKey('agent8-cert.pem');
const ca = loadKey('fake-startcom-root-cert.pem');

const server = http2.createSecureServer({ key, cert });

server.on('stream', (stream, headers) => {
  const name = headers[HTTP2_HEADER_PATH].slice(1);
  const file = path.resolve(common.fixturesDir, name);
  fs.stat(file, (err, stat) => {
    if (err != null || stat.isDirectory()) {
      stream.respond({ [HTTP2_HEADER_STATUS]: 404 });
      stream.end();
    } else {
      stream.respond({ [HTTP2_HEADER_STATUS]: 200 });
      const str = fs.createReadStream(file);
      str.pipe(stream);
    }
  });
});

server.listen(0, () => {

  const secureContext = tls.createSecureContext({ ca });
  const client = http2.connect(`https://localhost:${server.address().port}`,
                               { secureContext });

  let remaining = 2;
  function maybeClose() {
    if (--remaining === 0) {
      client.destroy();
      server.close();
    }
  }

  // Request for a file that does exist, response is 200
  const req1 = client.request({ [HTTP2_HEADER_PATH]: '/a.js' },
                              { endStream: true });
  req1.on('response', common.mustCall((headers) => {
    assert.strictEqual(headers[HTTP2_HEADER_STATUS], 200);
  }));
  let req1_data = '';
  req1.setEncoding('utf8');
  req1.on('data', (chunk) => req1_data += chunk);
  req1.on('end', common.mustCall(() => {
    assert.strictEqual(req1_data, ajs_data);
    maybeClose();
  }));

  // Request for a file that does not exist, response is 404
  const req2 = client.request({ [HTTP2_HEADER_PATH]: '/does_not_exist' },
                              { endStream: true });
  req2.on('response', common.mustCall((headers) => {
    assert.strictEqual(headers[HTTP2_HEADER_STATUS], 404);
  }));
  req2.on('data', common.mustNotCall());
  req2.on('end', common.mustCall(() => maybeClose()));

});
