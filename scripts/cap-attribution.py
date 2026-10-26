#!/usr/bin/env python3
"""External diagnostic attribution; never a mobile acceptance receipt."""
import argparse,json,pathlib
import sys

def summarize(directory):
 raw=json.loads((directory/'observer.json').read_text())
 source=json.loads((directory/'source.json').read_text());canonical=json.loads((directory/'canonical/report.json').read_text())
 if source['source']!=SOURCE or source['tree']!='6c26511caaff846e42a2417076ed2a7acaf69e02' or raw['source']!=SOURCE or canonical['candidateCommit']!=SOURCE or canonical['sourceSha']!=SOURCE or canonical['candidateTree']!=source['tree']:raise ValueError('Exact source binding missing')
 if canonical['kind']!='button-mobile-memory' or canonical['status'] not in ['passed','failed'] or canonical['cleanup']!={'containersRemoved':True}:raise ValueError('Canonical result or cleanup missing')
 actual=[]
 for file in sorted((directory/'canonical').rglob('*')):
  if file.is_file() and file.name!='report.json':actual.append({'path':str(file.relative_to(directory/'canonical')),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
 if sorted(canonical['artifacts'],key=lambda x:x['path'])!=actual:raise ValueError('Canonical inventory incomplete')
 result={'kind':'nonmergeable-cap-attribution','acceptanceEligible':False,'status':'incomplete','errors':[],'victims':[],'ignoredForeignVictims':raw.get('ignoredForeignVictims',0),'source':source,'canonicalStatus':canonical['status']}
 def need(value,message):
  if not value: result['errors'].append(message)
 need(raw.get('capability',{}).get('available') is True,'Kernel trace capability missing')
 capability=raw.get('capability',{});fmt=capability.get('format','')
 need(capability.get('clock')=='mono' and capability.get('event')=='oom:mark_victim' and hashlib.sha256(fmt.encode()).hexdigest()==capability.get('formatSha256') and bool(re.search(r'field:.*\bpid\b',fmt)) and bool(capability.get('kernelRelease')),'Actual kernel format/clock capability missing')
 need(raw.get('capability',{}).get('dockerEventsSubscribed') is True,'Docker lifecycle subscription unconfirmed')
 need(raw.get('lostEvents')==0 and raw.get('kernelLogLost')==0,'Trace or kernel context records lost or unavailable')
 need(raw.get('ownedContainersRemoved') is True,'Owned containers not positively collected')
 need(raw.get('cleanup')=={'traceRemoved':True,'childrenClosed':True},'Owned observer cleanup incomplete')
 need(not raw.get('errors'),'Observer collection errors')
 for event in raw.get('victims',[]):
  context=event.get('kernelContext')
  if context is None:
   result['ignoredForeignVictims']+=1;continue
  matches=[c for c in raw['containers'] if context.get('containerId')==c['id'] and context.get('taskMemcg')==context.get('oomMemcg')==c['cgroup']]
  need(len(matches)==1 and context.get('constraint')=='CONSTRAINT_MEMCG' and context.get('pid')==event['pid'] and 0<=event['mono']-context.get('mono',-100)<=.25,'Exact kernel memcg/victim context is missing or ambiguous')
  if len(matches)!=1:continue
  c=matches[0]
  prior=[{**p,'sampleMono':p.get('observedMono',frame['mono'])} for frame in c['samples'] for p in frame['processes'] if p['pid']==event['pid'] and p.get('observedMono',frame['mono'])<=context['mono'] and context['mono']-p.get('observedMono',frame['mono'])<=.25]
  need(len({p['startTime'] for p in prior})<=1,'Victim PID reuse makes prior lifetime association ambiguous')
  if event.get('identity') is not None:
   identity=event['identity'];need(bool(prior) and all(p['startTime']==identity['startTime'] and p['namespacePids']==identity['namespacePids'] for p in prior),'Supplied victim lifetime conflicts with prior PID/namespace identity')
  result['victims'].append({'mono':event['mono'],'pid':event['pid'],'comm':context['comm'],'kernelContext':context,'kernelScalars':event.get('kernelScalars',{}),'containerId':c['id'],'label':c['label'],'binding':'kernel-memcg-context','priorObservations':prior,'lifetimeIdentity':'prior-only-unconfirmed' if prior else 'unobserved'})
 need(len({c['id'] for c in raw['containers']})==len(raw['containers']) and len({c['label'] for c in raw['containers']})==len(raw['containers']),'Duplicate owned container identity')
 need(any(c['label']=='normal' for c in raw['containers']),'Normal startup profile absent')
 expected={p.parent.name:json.loads(p.read_text())['Id'] for p in (directory/'canonical').glob('*/docker-after.json')}
 need({c['label']:c['id'] for c in raw['containers']}==expected,'Every canonical container requires exact observer identity')
 for c in raw.get('containers',[]):
  need(c.get('memoryMax')==512000000 and c.get('swapMax')==0,'Strict container cap missing')
  if c['label']!='negative':
   need(any(any(p['category']=='harness-node' and p.get('rollupKiB') for p in categories(frame['processes'])) and any(p['category']=='browser-tree' and p.get('rollupKiB') for p in frame['processes']) for frame in c['samples']),'Live harness Node and browser memory samples missing')
  p=directory/'canonical'/c['label']; inside=json.loads((p/'inside.json').read_text());docker=json.loads((p/'docker-after.json').read_text())
  need(docker['Id']==c['id'],'Canonical container identity mismatch')
  delta=inside['after']['events']['oom_kill']-inside['before']['events']['oom_kill']
  need(len([v for v in result['victims'] if v['containerId']==c['id']])==delta,'Kernel kill count lacks exact victim correlation')
  if c['label']=='negative':
   need(inside['status']=='passed' and inside['childSignal']=='SIGKILL' and delta==1 and docker['State']['OOMKilled'] is True and docker['State']['ExitCode']==0,'Actual control did not pass')
   need(all(not v['priorObservations'] or all(p.get('oomScoreAdj')==1000 for p in v['priorObservations']) for v in result['victims'] if v['containerId']==c['id']),'Observed control lifetime does not identify the deliberate allocating child')
 need(any(c['label']=='negative' for c in raw.get('containers',[])),'Negative control absent')
 result['processSamples']=[{'containerId':c['id'],'label':c['label'],'mono':frame['mono'],'current':frame['current'],'peak':frame['peak'],'stat':frame['stat'],'processes':categories(frame['processes']),'incompleteProcesses':frame.get('incompleteProcesses',[]),'durationSeconds':frame.get('durationSeconds')} for c in raw['containers'] for frame in c['samples']]
 result['limits']=['Host observer outside unchanged whole-container cap; diagnostic perturbation possible','Process/PSS samples are sequential, non-atomic and not interchangeable with cgroup charge','No physical iPhone, app allocation stack or release acceptance claim']
 result['status']='incomplete' if result['errors'] else 'complete'
 (directory/'attribution.json').write_text(json.dumps(result,indent=2)+'\n')
 return result

# Host adapter: never reads argv, environ, maps contents, or application payloads.
import os,time,select,signal,subprocess,hashlib,re,uuid,socket,http.client,threading,queue,urllib.parse,resource
SOURCE='fe42f57e880c5edafc26b01af954bfe3205e1d22'
IMAGE='mcr.microsoft.com/playwright@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e'
INTERVAL=.05

def scalar_pairs(text):
 return {k:int(v.split()[0]) for line in text.splitlines() if ':' in line for k,v in [line.split(':',1)] if v.strip() and v.strip().split()[0].isdigit()}

def process_identity(proc,pid,cgroup,with_memory=True):
 directory=proc/str(pid)
 # Membership is read before any process metadata; unowned processes are not sampled.
 membership=(directory/'cgroup').read_text().strip()
 if membership!='0::'+cgroup:return None
 stat=(directory/'stat').read_text();fields=stat[stat.rindex(')')+2:].split();start=int(fields[19])
 status=(directory/'status').read_text();ns=re.search(r'^NSpid:\s*(.*)$',status,re.M)
 if not ns:raise ValueError('Namespace PID capability missing')
 result={'pid':pid,'ppid':int(fields[1]),'startTime':start,'namespacePids':[int(x) for x in ns[1].split()],'cgroup':cgroup,'comm':stat[stat.index('(')+1:stat.rindex(')')][:32],'oomScoreAdj':int((directory/'oom_score_adj').read_text())}
 if with_memory:
  result['statusKiB']={k:v for k,v in scalar_pairs(status).items() if k in ['VmRSS','RssAnon','RssFile','RssShmem','VmSwap']}
  result['rollupKiB']={k:v for k,v in scalar_pairs((directory/'smaps_rollup').read_text()).items() if k in ['Rss','Pss','Pss_Anon','Pss_File','Pss_Shmem','Anonymous','Swap']}
 again=(directory/'stat').read_text();now=again[again.rindex(')')+2:].split()
 if int(now[19])!=start or (directory/'cgroup').read_text().strip()!=membership:raise ValueError('Process identity changed during read')
 result['observedMono']=time.monotonic()
 return result

def categories(processes):
 bypid={p['pid']:p for p in processes}
 for p in processes:
  ancestor=p;seen=set();p['category']='harness-node' if p['comm'] in ['chain-node','node'] else 'other-or-unresolved'
  while ancestor and ancestor['pid'] not in seen:
   if ancestor['comm']=='MiniBrowser':p['category']='browser-tree';break
   seen.add(ancestor['pid']);ancestor=bypid.get(ancestor.get('ppid'))
 return processes

def cleanup_owned_containers(containers,repo,canonical):
 receipt={'removed':[],'alreadyRemoved':[],'unresolved':[]}
 for c in containers:
  cid=c['id']
  try:
   template='{{json .Id}}|{{json .HostConfig.Memory}}|{{json .HostConfig.MemorySwap}}|{{json .Config.Image}}|{{json .Mounts}}'
   result=subprocess.run(['docker','inspect','--format',template,cid],capture_output=True,text=True,timeout=2)
   if result.returncode:
    if 'No such object' in result.stderr or 'No such container' in result.stderr:receipt['alreadyRemoved'].append(cid)
    else:receipt['unresolved'].append(cid)
    continue
   ident,memory,swap,image,mounts=[json.loads(v) for v in result.stdout.strip().split('|')];mounts={m['Destination']:m for m in mounts}
   if ident!=cid or memory!=swap or memory!=512000000 or image!=IMAGE or mounts.get('/repo',{}).get('Source')!=str(repo) or mounts.get('/evidence',{}).get('Source')!=str(canonical/c['label']):
    receipt['unresolved'].append(cid);continue
   removed=subprocess.run(['docker','rm','--force',cid],capture_output=True,text=True,timeout=2)
   check=subprocess.run(['docker','inspect','--format','{{.Id}}',cid],capture_output=True,text=True,timeout=2)
   if removed.returncode==0 and check.returncode and ('No such object' in check.stderr or 'No such container' in check.stderr):receipt['removed'].append(cid)
   else:receipt['unresolved'].append(cid)
  except Exception:receipt['unresolved'].append(cid)
 return receipt

def collect(args):
 output=args.output;output.mkdir(parents=True,exist_ok=True)
 raw={'source':SOURCE,'capability':{'available':False},'cleanup':{'traceRemoved':False,'childrenClosed':False},'lostEvents':None,'kernelLogLost':None,'errors':[],'containers':[],'victims':[],'ignoredForeignVictims':0,'intervalSeconds':INTERVAL,'observerOutsideCap':True}
 instance=None;created=False;events=None;response=None;event_thread=None;event_queue=queue.Queue(maxsize=256);thread_stop=threading.Event();tracefd=None;stream=None;stop=False;pending=b'';lost=0;kmsg=None;kseq=None;contexts=[];traces=[];used_contexts=set();known={};started=time.monotonic()
 def emit(kind,data):
  stream.write(json.dumps({'kind':kind,'mono':time.monotonic(),'data':data})+'\n');stream.flush()
  if stream.tell()>32*1024*1024:raise ValueError('Bounded observation inventory exceeded')
 def error(message):
  # Only fixed diagnostic strings; OS errors may contain private filesystem content.
  raw['errors'].append(message);emit('error',message)
 def stopping(*unused):
  nonlocal stop;stop=True
 signal.signal(signal.SIGTERM,stopping);signal.signal(signal.SIGINT,stopping)
 try:
  stream=(output/'observations.ndjson').open('w')
  if os.geteuid()!=0 or sys.platform!='linux':raise ValueError('Root Linux host required')
  # Create only our unique instance; never mount tracefs or modify global tracing.
  raw['capability']['phase']='tracefs-instance'
  instance=pathlib.Path('/sys/kernel/tracing/instances')/('chain-cap-'+uuid.uuid4().hex)
  instance.mkdir();created=True;(instance/'tracing_on').write_text('0');(instance/'current_tracer').write_text('nop');(instance/'buffer_size_kb').write_text('256');(instance/'trace_clock').write_text('mono')
  raw['capability']['phase']='actual-event-format'
  fmt=(instance/'events/oom/mark_victim/format').read_text()
  if not all(re.search(r'field:.*\b'+field+r'\b',fmt) for field in ['pid']):raise ValueError('OOM event identity format unavailable')
  if '[mono]' not in (instance/'trace_clock').read_text():raise ValueError('Actual monotonic trace clock not confirmed')
  raw['capability']['phase']='kernel-context-open'
  kmsg=os.open('/dev/kmsg',os.O_RDONLY|os.O_NONBLOCK);os.lseek(kmsg,0,os.SEEK_END);raw['kernelLogLost']=0
  (instance/'events/oom/mark_victim/enable').write_text('1');tracefd=os.open(instance/'trace_pipe',os.O_RDONLY|os.O_NONBLOCK);(instance/'tracing_on').write_text('1')
  raw['capability']['phase']='trace-loss-counters'
  stats=list((instance/'per_cpu').glob('cpu*/stats'))
  if not stats:raise ValueError('Trace loss counters unavailable')
  for p in stats:
   values=scalar_pairs(p.read_text())
   if not all(k in values for k in ['overrun','commit overrun','dropped events']):raise ValueError('Trace loss counter format unavailable')
  raw['capability']={'available':True,'event':'oom:mark_victim','clock':'mono','formatSha256':hashlib.sha256(fmt.encode()).hexdigest(),'instance':instance.name,'format':fmt,'kernelContext':'/dev/kmsg CONSTRAINT_MEMCG exact oom_memcg/task_memcg','kernelRelease':os.uname().release,'kernelVersion':os.uname().version,'lossCounters':['overrun','commit overrun','dropped events']};emit('capability',raw['capability'])
  class DockerHTTP(http.client.HTTPConnection):
   def connect(self):
    self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(5);self.sock.connect('/var/run/docker.sock')
  events=DockerHTTP('localhost',timeout=5)
  filters=json.dumps({'type':['container'],'event':['start','die','destroy']})
  events.request('GET','/events?'+urllib.parse.urlencode({'filters':filters}));response=events.getresponse()
  if response.status!=200:raise ValueError('Docker event subscription refused')
  events.sock.settimeout(None)
  def read_events():
   try:
    while not thread_stop.is_set():
     line=response.readline(65537)
     if not line:break
     if len(line)>65536:raise ValueError('Docker event bound exceeded')
     event_queue.put_nowait(json.loads(line))
   except Exception:
    if not thread_stop.is_set():raw['errors'].append('Docker event stream lost or malformed records')
  event_thread=threading.Thread(target=read_events,daemon=True);event_thread.start();raw['capability']['dockerEventsSubscribed']=True
  emit('lifecycle-subscription',{'confirmed':True})
  # A ready handshake precedes the unchanged canonical command, not its burst.
  print(json.dumps({'ready':True,'pid':os.getpid(),'startTime':process_identity(pathlib.Path('/proc'),os.getpid(),(pathlib.Path('/proc/self/cgroup').read_text().strip().split('::',1)[1]),False)['startTime']}),flush=True)
  deadline=time.monotonic()+480;lastsample=0
  def discover(cid):
   if not re.fullmatch('[a-f0-9]{64}',cid) or cid in known:return
   # Project only nonpayload configuration fields; never request Config.Cmd/Env.
   template='{{json .Id}}|{{json .State.Pid}}|{{json .HostConfig.Memory}}|{{json .HostConfig.MemorySwap}}|{{json .Config.Image}}|{{json .Mounts}}'
   r=subprocess.run(['docker','inspect','--format',template,cid],capture_output=True,text=True,timeout=2)
   if r.returncode:return
   values=[json.loads(x) for x in r.stdout.strip().split('|')];ident,pid,cap,swap,image,mounts=values
   mounts={m['Destination']:m for m in mounts};repo=mounts.get('/repo',{});evidence=mounts.get('/evidence',{})
   if image!=IMAGE or repo.get('Source')!=str(args.repo) or evidence.get('Source') not in [str(args.canonical/x) for x in ['negative','normal','reduced']]:return
   if not repo.get('RW') is False or cap!=512000000 or swap!=512000000 or pid<=0:raise ValueError('Owned Docker boundary mismatch')
   cg=(pathlib.Path('/proc')/str(pid)/'cgroup').read_text().strip()
   if not cg.startswith('0::/') or cid not in cg:raise ValueError('Owned cgroup does not bind exact container ID')
   relative=cg.split('::',1)[1];directory=pathlib.Path('/sys/fs/cgroup')/relative.lstrip('/')
   if '..' in pathlib.PurePosixPath(relative).parts or not directory.is_dir():raise ValueError('Unsafe cgroup path')
   c={'id':ident,'label':pathlib.Path(evidence['Source']).name,'cgroup':relative,'memoryMax':cap,'swapMax':0,'initPid':pid,'samples':[]};known[cid]=c;raw['containers'].append(c);emit('container',{k:v for k,v in c.items() if k!='samples'})
  def sample(c):
   directory=pathlib.Path('/sys/fs/cgroup')/c['cgroup'].lstrip('/')
   if not directory.exists():return
   def num(name):return int((directory/name).read_text())
   if num('memory.max')!=512000000 or num('memory.swap.max')!=0 or num('memory.swap.current')!=0:raise ValueError('Observed boundary changed')
   frame={'mono':time.monotonic(),'current':num('memory.current'),'peak':num('memory.peak'),'events':dict((k,int(v)) for k,v in (l.split() for l in (directory/'memory.events').read_text().splitlines())),'stat':dict((k,int(v)) for k,v in (l.split() for l in (directory/'memory.stat').read_text().splitlines())),'processes':[]}
   paths=[directory]+list(directory.rglob('cgroup.procs'))
   pids=set()
   for p in paths:
    target=p/'cgroup.procs' if p==directory else p
    pids.update(int(v) for v in target.read_text().split())
   if len(pids)>64 or len(c['samples'])>=3600:raise ValueError('Process/sample bound exceeded')
   for pid in sorted(pids):
    try:
     identity=process_identity(pathlib.Path('/proc'),pid,c['cgroup'])
     if identity:frame['processes'].append(identity)
     else:frame.setdefault('incompleteProcesses',[]).append({'pid':pid,'reason':'membership changed; no scalar sample inferred'})
    except (OSError,ValueError):frame.setdefault('incompleteProcesses',[]).append({'pid':pid,'reason':'exited-or-unreadable; no scalar sample inferred'})
   frame['durationSeconds']=time.monotonic()-frame['mono'];categories(frame['processes']);c['samples'].append(frame);emit('sample',{'id':c['id'],**frame})
  while not stop and time.monotonic()<deadline:
   readable,_,_=select.select([sys.stdin.fileno(),tracefd,kmsg],[],[],INTERVAL)
   if sys.stdin.fileno() in readable and os.read(sys.stdin.fileno(),1024)==b'':stop=True
   while not event_queue.empty():
    event=event_queue.get_nowait();cid=event.get('Actor',{}).get('ID','')
    if event.get('Action')=='start':discover(cid)
   if kmsg in readable:
    try:
     while True:
      record=os.read(kmsg,65536).decode(errors='replace');header,body=record.split(';',1);parts=header.split(',');priority,seq,stamp=int(parts[0]),int(parts[1]),int(parts[2])
      if kseq is not None and seq!=kseq+1:raw['kernelLogLost']+=abs(seq-kseq-1)
      kseq=seq
      if priority>>3!=0:continue
      if 'oom-kill:' not in body:continue
      match=re.search(r'oom-kill:constraint=(CONSTRAINT_MEMCG),.*?oom_memcg=([^,]+),task_memcg=([^,]+),task=(.*),pid=(\d+),uid=(\d+)',body)
      if not match:continue
      constraint,oomcg,taskcg,comm,pid,uid=match.groups();owned=next((c for c in known.values() if c['cgroup']==oomcg==taskcg),None)
      if not owned:
       # A lifecycle race can only be resolved by revalidating exact mounts/image/cap.
       cid=re.search(r'([a-f0-9]{64})',taskcg)
       if cid:discover(cid[1]);owned=next((c for c in known.values() if c['cgroup']==oomcg==taskcg),None)
      if not owned:raw['ignoredForeignVictims']+=1;continue
      context={'mono':stamp/1000000,'sequence':seq,'containerId':owned['id'],'oomMemcg':oomcg,'taskMemcg':taskcg,'pid':int(pid),'comm':comm[:32],'uid':int(uid),'constraint':constraint}
      contexts.append(context);emit('kernel-context',context)
      if len(contexts)>32:raise ValueError('Owned kernel context bound exceeded')
    except BlockingIOError:pass
    except OSError:raw['kernelLogLost']+=1;error('Kernel context records lost or unavailable')
   if tracefd in readable:
    pending+=os.read(tracefd,65536)
    while b'\n' in pending:
     line,pending=pending.split(b'\n',1);text=line.decode(errors='replace')
     match=re.search(r'\s(\d+\.\d+):\s+mark_victim:\s+pid=(\d+)(?:\s|$)',text)
     if not match:
      if 'LOST' in text:lost+=1
      elif text.strip():error('Unrecognized kernel victim record')
      continue
     event={'mono':float(match[1]),'pid':int(match[2]),'kernelScalars':{k:int(v) for k,v in re.findall(r'([a-z_-]+)[=:](\d+)(?:kB)?',text[match.start():]) if k in ['total-vm','anon-rss','file-rss','shmem-rss','uid','pgtables','oom_score_adj']}}
     traces.append(event)
     if len(traces)>128:raise ValueError('Kernel victim event bound exceeded')
   for index,event in enumerate(traces):
    if event.get('consumed'):continue
    candidates=[(i,c) for i,c in enumerate(contexts) if c['pid']==event['pid'] and 0<=event['mono']-c['mono']<=.25]
    if len(candidates)>1:error('Ambiguous kernel victim/context correlation');event['consumed']=True;continue
    if len(candidates)==1:
     ci,context=candidates[0]
     if ci in used_contexts:error('Repeated kernel context/victim correlation');event['consumed']=True;continue
     used_contexts.add(ci);event['consumed']=True
     owned_event={k:v for k,v in event.items() if k!='consumed'};owned_event['kernelContext']=context;raw['victims'].append(owned_event);emit('victim',owned_event)
   if not event_thread.is_alive() and not stop:raise ValueError('Docker event stream closed')
   if time.monotonic()-lastsample>=INTERVAL:
    lastsample=time.monotonic()
    for c in known.values():sample(c)
  if not stop:error('Observer deadline reached')
 except Exception as failure:
  raw['capability']['failureType']=type(failure).__name__;raw['capability']['failureErrno']=getattr(failure,'errno',None)
  raw['errors'].append('Host observer capability or collection failed; partial observations retained')
  if not raw['capability']['available']:print(json.dumps({'ready':False}),flush=True)
 finally:
  thread_stop.set()
  if events:
   if events.sock:
    try:events.sock.shutdown(socket.SHUT_RDWR)
    except OSError:pass
   if event_thread:event_thread.join(timeout=3)
   if event_thread is None or not event_thread.is_alive():
    if response:response.close()
    events.close();raw['cleanup']['childrenClosed']=True
   else:raw['errors'].append('Owned lifecycle reader did not close')
  else:raw['cleanup']['childrenClosed']=True
  raw['containerCleanup']=cleanup_owned_containers(list(known.values()),args.repo,args.canonical);raw['ownedContainersRemoved']=not raw['containerCleanup']['unresolved']
  if raw['containerCleanup']['removed']:raw['errors'].append('Canonical command left owned containers; diagnostic cleanup collected them')
  if not raw['ownedContainersRemoved']:raw['errors'].append('Owned container cleanup unresolved')
  if not created:raw['cleanup']['traceRemoved']=True
  if created:
   try:
    (instance/'tracing_on').write_text('0')
    event_enable=instance/'events/oom/mark_victim/enable'
    if event_enable.exists():event_enable.write_text('0')
   except OSError:raw['errors'].append('Owned trace disable failed')
   try:
    totals=[]
    for p in (instance/'per_cpu').glob('cpu*/stats'):
     values=scalar_pairs(p.read_text());totals.append(sum(values[k] for k in ['overrun','commit overrun','dropped events']))
    raw['lostEvents']=lost+sum(totals) if totals else None
   except (OSError,KeyError):raw['errors'].append('Trace loss accounting unavailable')
   if kmsg is not None:
    try:os.close(kmsg)
    except OSError:raw['errors'].append('Owned kernel context descriptor close failed')
   if tracefd is not None:
    try:
     if os.read(tracefd,65536):raw['errors'].append('Unconsumed kernel records at stop; attribution incomplete')
    except BlockingIOError:pass
    except OSError:raw['errors'].append('Final trace drain failed')
    finally:os.close(tracefd)
   try:instance.rmdir();raw['cleanup']['traceRemoved']=True
   except OSError:raw['errors'].append('Owned trace removal failed')
  if len(used_contexts)!=len(contexts):raw['errors'].append('Owned kernel context lacks a unique victim trace')
  raw['observerCost']={'wallSeconds':time.monotonic()-started,'cpuUserSeconds':resource.getrusage(resource.RUSAGE_SELF).ru_utime,'cpuSystemSeconds':resource.getrusage(resource.RUSAGE_SELF).ru_stime,'maxRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
  if stream:stream.close()
  (output/'observer.json').write_text(json.dumps(raw,indent=2)+'\n')
 return 0 if not raw['errors'] else 1

def run(args):
 output=args.output.resolve();repo=args.repo.resolve()
 if output.exists():raise ValueError('New external evidence directory required')
 if output==repo or repo in output.parents:raise ValueError('Evidence must be outside checkout')
 output.mkdir(parents=True);canonical=output/'canonical'
 child=None;worker=None;result={'kind':'nonmergeable-cap-attribution-command','acceptanceEligible':False,'canonicalExit':None,'observerExit':None,'cleanup':{'canonicalChildClosed':True,'observerClosed':True},'errors':[]}
 stop=False
 def stopping(*unused):
  nonlocal stop;stop=True
 signal.signal(signal.SIGTERM,stopping);signal.signal(signal.SIGINT,stopping)
 try:
  git=lambda *a:subprocess.check_output(['git','-C',str(repo),*a],text=True).strip()
  if git('rev-parse','HEAD')!=SOURCE or git('rev-parse','HEAD^{tree}')!='6c26511caaff846e42a2417076ed2a7acaf69e02' or git('status','--porcelain=v1'):raise ValueError('Frozen clean fe42 source required')
  files={name:hashlib.sha256((repo/name).read_bytes()).hexdigest() for name in git('ls-files','-z').split('\0') if name}
  identity={'source':SOURCE,'tree':git('rev-parse','HEAD^{tree}'),'files':files,'workflowCommit':os.environ['GITHUB_SHA'],'runId':os.environ['GITHUB_RUN_ID'],'runAttempt':int(os.environ['GITHUB_RUN_ATTEMPT']),'eventName':os.environ['GITHUB_EVENT_NAME'],'eventRef':os.environ['GITHUB_REF'],'eventPolicy':os.environ['CHAIN_TEST_EVENT_POLICY'],'repository':os.environ['GITHUB_REPOSITORY'],'observerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
  if os.environ.get('CI')!='true' or identity['eventName']!='push' or identity['eventRef']!='refs/heads/diagnose/webkit-cap-canonical-startup' or identity['eventPolicy']!='outgoing-branch-push-v1' or os.environ.get('CHAIN_TEST_SOURCE_SHA')!=SOURCE:raise ValueError('Actual hosted diagnostic admission required')
  (output/'source.json').write_text(json.dumps(identity,indent=2)+'\n')
  worker=subprocess.Popen(['sudo','-n',sys.executable,str(pathlib.Path(__file__).resolve()),'--observe','--repo',str(repo),'--output',str(output),'--canonical',str(canonical)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
  readable,_,_=select.select([worker.stdout],[],[],15)
  if not readable:raise ValueError('Observer ready handshake timed out')
  ready=json.loads(worker.stdout.readline());result['observerIdentity']=ready
  if not ready.get('ready'):raise ValueError('Kernel observer capability unavailable; no canonical invocation started')
  with (output/'canonical.stdout.txt').open('w') as stdout,(output/'canonical.stderr.txt').open('w') as stderr:
   child=subprocess.Popen(['node','scripts/button-safety-mobile-memory.mjs','--run','--output-dir',str(canonical)],cwd=repo,stdout=stdout,stderr=stderr,start_new_session=True)
   deadline=time.monotonic()+420
   while child.poll() is None and not stop and time.monotonic()<deadline:time.sleep(.05)
   if child.poll() is None:raise ValueError('Owned command interrupted or outer deadline exceeded')
   result['canonicalExit']=child.returncode
 except Exception as e:result['errors'].append(str(e))
 finally:
  if child and child.poll() is None:
   try:os.killpg(child.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:child.wait(timeout=3)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=3)
  if worker:
   worker.stdin.close()
   try:worker.wait(timeout=30)
   except subprocess.TimeoutExpired:
    # Root worker has its own480s deadline. Do not signal an unverified root PID.
    result['errors'].append('Owned observer did not close promptly; root worker remains bounded by its own deadline')
   result['observerExit']=worker.poll();result['cleanup']['observerClosed']=worker.poll() is not None
  result['cleanup']['canonicalChildClosed']=child is None or child.poll() is not None
  (output/'command.json').write_text(json.dumps(result,indent=2)+'\n')
  summary=safe_summary(output)
 return 0 if result['canonicalExit']==0 and result['observerExit']==0 and summary and summary['status']=='complete' and not result['errors'] else 1

def safe_summary(directory):
 try:return summarize(directory)
 except Exception:
  result={'kind':'nonmergeable-cap-attribution','acceptanceEligible':False,'status':'incomplete','errors':['Missing or malformed attribution/canonical evidence']}
  (directory/'attribution.json').write_text(json.dumps(result,indent=2)+'\n');return result

if __name__=='__main__':
 p=argparse.ArgumentParser();mode=p.add_mutually_exclusive_group(required=True);mode.add_argument('--summarize',type=pathlib.Path);mode.add_argument('--observe',action='store_true');mode.add_argument('--run',action='store_true');p.add_argument('--repo',type=pathlib.Path);p.add_argument('--output',type=pathlib.Path);p.add_argument('--canonical',type=pathlib.Path);a=p.parse_args()
 try:
  if a.summarize:
   r=safe_summary(a.summarize);code=0 if r['status']=='complete' else 1
  elif a.observe:
   if not a.repo or not a.output or not a.canonical:p.error('Observer paths required')
   code=collect(a)
  else:
   if not a.repo or not a.output:p.error('Run paths required')
   code=run(a)
 except Exception:
  code=1
 sys.exit(code)
