import {randomBytes} from 'node:crypto';
import {hash,fail} from '../domain.mjs';
import {tokenCipher} from '../providers/mail/oauth.mjs';

export async function packagePairing(store,config,base) {
  const code=randomBytes(32).toString('base64url'),expiresAt=Date.now()+15*60000;
  await store.db.prepare('DELETE FROM oauth_states WHERE expires<?').run(Date.now());
  await store.db.prepare('INSERT INTO oauth_states(id,secret,expires) VALUES(?,?,?)').run(`extension-package:${hash(code)}`,tokenCipher(config).seal({purpose:'extension-package',base}),expiresAt);
  return {serverUrl:base,pairingCode:code,expiresAt};
}
export async function redeemPackage(data,store,config) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(data.code || ''))fail('Download a fresh extension package.',401);
  const row=await store.db.prepare('SELECT * FROM oauth_states WHERE id=?').get(`extension-package:${hash(data.code)}`);
  if(!row || row.expires<Date.now())fail('The installation code expired or was used. Pair from Connections.',401);
  const saved=tokenCipher(config).open(row.secret);
  if(saved.purpose!=='extension-package')fail('Invalid installation code.',401);
  const consumed=await store.db.prepare('DELETE FROM oauth_states WHERE id=?').run(row.id);
  if(!consumed.changes)fail('Installation code already used.',401);
  const token=randomBytes(32).toString('base64url'),expiresAt=Date.now()+86400000;
  await store.db.prepare('INSERT INTO extension_tokens(id,expires) VALUES(?,?)').run(hash(token),expiresAt);
  return {token,expiresAt,serverUrl:saved.base};
}
