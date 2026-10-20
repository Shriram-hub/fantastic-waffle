import {readFile} from 'node:fs/promises';
import {crc32} from 'node:zlib';

const files=['manifest.json','background.mjs','location.mjs','autofill.mjs','linkedin.mjs','confirmation.js','copilot.js','workspace-bridge.js','popup.html','popup.mjs','popup.css'];
export async function extensionPackage() {
  const local=[],central=[];let offset=0;
  for(const name of files) {
    const bytes=await readFile(new URL(`../../extension/${name}`,import.meta.url)),path=Buffer.from(`orbit-extension/${name}`),checksum=crc32(bytes);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(checksum,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(path.length,26);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(33,14);entry.writeUInt32LE(checksum,16);entry.writeUInt32LE(bytes.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(path.length,28);entry.writeUInt32LE(offset,42);
    local.push(header,path,bytes);central.push(entry,path);offset+=header.length+path.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
