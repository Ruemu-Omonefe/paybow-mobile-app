const strict = /^[A-Za-z0-9+/]*={0,2}$/;
module.exports = {
  encodeBase64: (u) => Buffer.from(u).toString('base64'),
  decodeBase64: (s) => { if (typeof s !== 'string' || s.length % 4 || !strict.test(s)) throw new Error('invalid encoding'); return new Uint8Array(Buffer.from(s, 'base64')); },
  decodeUTF8: (s) => new Uint8Array(Buffer.from(s, 'utf8')),
  encodeUTF8: (u) => Buffer.from(u).toString('utf8'),
};
