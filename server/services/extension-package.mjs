import {readFile} from 'node:fs/promises';
import {crc32} from 'node:zlib';

const files=['manifest.json','background.mjs','location.mjs','autofill.mjs','linkedin.mjs','confirmation.js','copilot.js','workspace-bridge.js','popup.html','popup.mjs','popup.css'];
export async function extensionPackage(config={}) {
  const local=[],central=[];let offset=0;
  const entries=await Promise.all(files.map(async name=>({name,bytes:await readFile(new URL(`../../extension/${name}`,import.meta.url))})));
  if(config.serverUrl) {
    const base=new URL(config.serverUrl).origin,manifest=entries.find(e=>e.name==='manifest.json'),data=JSON.parse(manifest.bytes.toString());
    data.host_permissions.push(`${base}/*`);data.content_scripts.push({matches:[`${base}/*`],js:['workspace-bridge.js'],run_at:'document_idle'});manifest.bytes=Buffer.from(JSON.stringify(data,null,2));
    entries.push({name:'config.json',bytes:Buffer.from(JSON.stringify(config))});
  }
  for(const {name,bytes} of entries) {
    const path=Buffer.from(`veloce-ai-extension/${name}`),checksum=crc32(bytes);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(checksum,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(path.length,26);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(33,14);entry.writeUInt32LE(checksum,16);entry.writeUInt32LE(bytes.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(path.length,28);entry.writeUInt32LE(offset,42);
    local.push(header,path,bytes);central.push(entry,path);offset+=header.length+path.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
