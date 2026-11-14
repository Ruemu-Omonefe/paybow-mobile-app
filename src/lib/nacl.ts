import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';

nacl.setPRNG((target, length) => {
  target.set(Crypto.getRandomBytes(length));
});

export default nacl;
