#!/usr/bin/env python3
"""Build only the fixed Linux amd64 native control; never execute it here."""
import base64, hashlib, json, pathlib, struct, subprocess, tempfile
source=''' .text
 .global _start
 .global diagnosticKnownHotLoop
 .type diagnosticKnownHotLoop,@function
_start:
 mov $1, %r12
 diagnosticKnownHotLoop:
 .Lhot:
 imul $1664525, %r12, %r12
 add $1013904223, %r12
 jmp .Lhot
 .size diagnosticKnownHotLoop, .-diagnosticKnownHotLoop
'''
with tempfile.TemporaryDirectory(prefix='diagnostic-known-build-') as temporary:
 p=pathlib.Path(temporary);(p/'known.S').write_text(source);subprocess.run(['/usr/bin/clang','--target=x86_64-linux-gnu','-c',str(p/'known.S'),'-o',str(p/'known.o')],check=True);obj=(p/'known.o').read_bytes();off=struct.unpack_from('<Q',obj,40)[0];sz,count,names=struct.unpack_from('<HHH',obj,58);sections=[struct.unpack_from('<IIQQQQIIQQ',obj,off+i*sz)for i in range(count)];st=sections[names];strings=obj[st[4]:st[4]+st[5]];text=next(s for s in sections if strings[s[0]:].split(b'\0')[0]==b'.text');code=obj[text[4]:text[4]+text[5]]
 # Deterministic static ELF layout, one RX segment, explicit native symbols.
 # No libc, dynamic loader, board input, credential access or child creation.
 base=0x400000;textoff=0x1000;strtab=b'\0_start\0diagnosticKnownHotLoop\0';shstr=b'\0.text\0.symtab\0.strtab\0.shstrtab\0.note.gnu.build-id\0';buildid=hashlib.sha256(code).digest()[:20];note=struct.pack('<III',4,20,3)+b'GNU\0'+buildid
 data=bytearray(b'\0'*(textoff+len(code)));data[textoff:]=code
 def append(b,alignment=8):
  while len(data)%alignment:data.append(0)
  at=len(data);data.extend(b);return at
 symbols=b'\0'*24+struct.pack('<IBBHQQ',1,0x12,0,1,base+textoff,7)+struct.pack('<IBBHQQ',8,0x12,0,1,base+textoff+7,len(code)-7)
 symoff=append(symbols);stroff=append(strtab);shstroff=append(shstr);noteoff=append(note);shoff=append(b'\0'*64)
 def section(name,typ,flags,addr,offset,size,link=0,info=0,align=1,entsize=0):data.extend(struct.pack('<IIQQQQIIQQ',shstr.index(name),typ,flags,addr,offset,size,link,info,align,entsize))
 section(b'.text',1,6,base+textoff,textoff,len(code),align=16);section(b'.symtab',2,0,0,symoff,len(symbols),3,1,8,24);section(b'.strtab',3,0,0,stroff,len(strtab));section(b'.shstrtab',3,0,0,shstroff,len(shstr));section(b'.note.gnu.build-id',7,0,0,noteoff,len(note),align=4)
 ident=b'\x7fELF\x02\x01\x01'+b'\0'*9;data[:64]=struct.pack('<16sHHIQQQIHHHHHH',ident,2,62,1,base+textoff,64,shoff,0,64,56,1,64,6,4);data[64:120]=struct.pack('<IIQQQQQQ',1,5,0,base,base,textoff+len(code),textoff+len(code),4096)
 compiler=pathlib.Path('/usr/bin/clang').resolve();record={'schemaVersion':1,'platform':'linux','architecture':'x64','symbol':'diagnosticKnownHotLoop','source':source,'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'buildCommand':'python3 scripts/agent-tools/build-native-known-control.py','compiler':{'path':str(compiler),'sha256':hashlib.sha256(compiler.read_bytes()).hexdigest(),'version':subprocess.check_output(['/usr/bin/clang','--version'],text=True)},'textHex':code.hex(),'elfSha256':hashlib.sha256(data).hexdigest(),'buildId':buildid.hex(),'elfBase64':base64.b64encode(data).decode()}
 print(json.dumps(record,indent=2))
