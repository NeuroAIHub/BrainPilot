import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const [reference,directory]=process.argv.slice(2);
if(process.platform!=='linux'||!reference||!directory)throw Error('Linux: provider-env new-output-directory');
const out=resolve(directory);await mkdir(out,{mode:0o700});
const env={};for(const line of(await readFile(reference,'utf8')).split(/\r?\n/)){const m=/^\s*(?:export\s+)?([A-Za-z_]\w*)=(.*)$/.exec(line);if(!m)continue;let v=m[2].trim();if((v[0]==='"'&&v.at(-1)==='"')||(v[0]==="'"&&v.at(-1)==="'"))v=v.slice(1,-1);env[m[1]]=v;}
const key=env.SQZ_API_KEY||env.CUSTOM_API_KEY||env.ANTHROPIC_API_KEY,configured=env.CUSTOM_BASE_URL||env.ANTHROPIC_BASE_URL;
if(!key||!configured)throw Error('Missing existing provider settings');
const base=configured.replace(/\/+$/,'').replace(/\/v1$/,'');
const clean=s=>String(s).split(key).join('[REDACTED]');
const save=(name,value)=>writeFile(join(out,name),typeof value==='string'?clean(value):clean(JSON.stringify(value,null,2))+'\n',{mode:0o600});
const tools=[
 {name:'read',description:'Read a file at the supplied path.',input_schema:{type:'object',properties:{path:{type:'string'},offset:{type:'integer'},limit:{type:'integer'}},required:['path'],additionalProperties:false}},
 {name:'ls',description:'List directory contents.',input_schema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}},
 {name:'bash',description:'Execute a shell command.',input_schema:{type:'object',properties:{command:{type:'string'}},required:['command'],additionalProperties:false}}
];
const one='Read /workspace/materials/raw_materials/idea_sparse.md using read. Call the tool only; do not invent file contents.';
const two='Read /workspace/materials/raw_materials/idea_sparse.md and /workspace/materials/raw_materials/experimental_log.md. Make two read tool calls in the same response, one for each path. Do not answer with file contents before reading them.';
const cases=[{id:'anthropic-read-one',protocol:'anthropic-messages',prompt:one},{id:'anthropic-read-two',protocol:'anthropic-messages',prompt:two},{id:'openai-read-two',protocol:'openai-completions',prompt:two}];
const results=[];
for(const c of cases){
 const anthropic=c.protocol==='anthropic-messages';
 const body=anthropic?{model:'kimi-k3',max_tokens:3072,stream:true,thinking:{type:'enabled',budget_tokens:2048,display:'summarized'},system:'You are a research assistant. Use tools to inspect named research materials; do not invent unseen file contents.',tools,messages:[{role:'user',content:c.prompt}]}:{model:'kimi-k3',max_tokens:3072,stream:true,stream_options:{include_usage:true},reasoning_effort:'low',tools:tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.input_schema}})),tool_choice:'auto',parallel_tool_calls:true,messages:[{role:'system',content:'You are a research assistant. Use tools to inspect named research materials; do not invent unseen file contents.'},{role:'user',content:c.prompt}]};
 await save(c.id+'.request.json',{protocol:c.protocol,body});
 let raw='',error=null,status=null,contentType=null,normalEof=false;const began=Date.now();
 try{
  const r=await fetch(base+(anthropic?'/v1/messages':'/v1/chat/completions'),{method:'POST',headers:anthropic?{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'}:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  status=r.status;contentType=r.headers.get('content-type');const reader=r.body.getReader(),decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done){normalEof=true;raw+=decoder.decode();break;}raw+=decoder.decode(value,{stream:true});if(raw.length>1000000)throw Error('Response exceeds diagnostic limit');}
 }catch(e){error=clean(e.message);}
 await save(c.id+'.sse',raw);
 const frames=raw.split(/\r?\n\r?\n/);const trailing=frames.pop();const events=[];const blocks=new Map();const finishReasons=[];
 for(const frame of frames){
  const lines=frame.split(/\r?\n/);const event=lines.find(l=>l.startsWith('event:'))?.slice(6).trim()??null;const data=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
  if(!data)continue;if(data==='[DONE]'){events.push({event,dataType:'DONE'});continue;}
  let item;try{item=JSON.parse(data);}catch{events.push({event,dataType:'INVALID_JSON',tail:data.slice(-160)});continue;}
  events.push({event,dataType:item.type??item.object??null,stopReason:item.delta?.stop_reason??null,usage:item.usage??item.message?.usage??null});
  if(anthropic){
   if(item.type==='content_block_start'&&item.content_block?.type==='tool_use')blocks.set(item.index,{name:item.content_block.name,args:'',initial:item.content_block.input,closed:false});
   if(item.type==='content_block_delta'&&item.delta?.type==='input_json_delta'&&blocks.has(item.index))blocks.get(item.index).args+=item.delta.partial_json??'';
   if(item.type==='content_block_stop'&&blocks.has(item.index))blocks.get(item.index).closed=true;
  }else for(const choice of item.choices??[]){
   if(choice.finish_reason)finishReasons.push(choice.finish_reason);
   for(const call of choice.delta?.tool_calls??[]){const b=blocks.get(call.index)??{name:'',args:'',closed:false};b.name+=call.function?.name??'';b.args+=call.function?.arguments??'';blocks.set(call.index,b);}
  }
 }
 const decodedTools=[...blocks.values()].map(b=>{let args=null,valid=false;try{args=b.args?JSON.parse(b.args):b.initial;valid=Boolean(args&&typeof args==='object'&&!Array.isArray(args));}catch{}return{name:b.name,args,validJson:valid,blockClosed:anthropic?b.closed:finishReasons.includes('tool_calls')};});
 const typedStop=events.some(e=>e.dataType==='message_stop'),headerStop=events.some(e=>e.event==='message_stop'&&e.dataType==='message_stop');
 const done=events.some(e=>e.dataType==='DONE');
 const complete=normalEof&&!error&&status===200&&(anthropic?headerStop:done&&finishReasons.length>0)&&decodedTools.length>0&&decodedTools.every(t=>t.validJson&&t.blockClosed);
 const result={id:c.id,protocol:c.protocol,status,contentType,normalEof,error,durationMs:Date.now()-began,bytes:Buffer.byteLength(raw),eventCount:events.length,messageStopType:typedStop,messageStopHeader:headerStop,done,finishReasons,trailingUnframed:trailing??'',tools:decodedTools,complete,events};
 results.push(result);await save(c.id+'.result.json',result);await save('summary.json',{modelId:'kimi-k3',endpointHash:createHash('sha256').update(configured).digest('hex'),credentialReference:reference,requests:results.length,results});
 console.log(JSON.stringify({id:c.id,status,normalEof,error,complete,messageStopType:typedStop,messageStopHeader:headerStop,done,finishReasons,tools:decodedTools,eventTail:events.slice(-5).map(({event,dataType,stopReason})=>({event,dataType,stopReason})),trailingBytes:Buffer.byteLength(trailing??''),durationMs:result.durationMs}));
}
