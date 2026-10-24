import {remoteJSON} from './http.mjs';
import {fail} from '../domain.mjs';

export const isGemini=config=>String(config.LLM_PROVIDER || '').toLowerCase()==='gemini';
function modelResource(model) {
  const name=String(model || '').replace(/^models\//,'');
  if(!/^[a-zA-Z0-9._-]{1,120}$/.test(name)) fail('Choose a valid Gemini model identifier.',503);
  return `models/${name}`;
}
const apiBase=base=>base.replace(/\/openai\/?$/,'').replace(/\/$/,'');
const headers=key=>({'X-goog-api-key':key,'Content-Type':'application/json'});

function compactSchema(schema) {
  if(!schema || typeof schema!=='object' || Array.isArray(schema)) return schema;
  // Large array/string bounds make Gemini's schema compiler reject the résumé
  // schema. Keep its structure here; structuredAI enforces every original Zod
  // constraint before returning or caching a result.
  const {minimum,maximum,minItems,maxItems,minLength,maxLength,...out}=schema;
  for(const key of ['properties','$defs','patternProperties']) if(out[key])
    out[key]=Object.fromEntries(Object.entries(out[key]).map(([name,value])=>[name,compactSchema(value)]));
  for(const key of ['items','additionalProperties','not']) if(out[key] && typeof out[key]==='object') out[key]=compactSchema(out[key]);
  for(const key of ['anyOf','oneOf','allOf','prefixItems']) if(Array.isArray(out[key])) out[key]=out[key].map(compactSchema);
  return out;
}

export async function generateGeminiJSON({base,model,key,instruction,input,schema},fetcher=fetch) {
  const response=await remoteJSON(`${apiBase(base)}/${modelResource(model)}:generateContent`,{
    method:'POST',headers:headers(key),body:JSON.stringify({
      systemInstruction:{parts:[{text:instruction}]},
      contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}],
      generationConfig:{responseMimeType:'application/json',responseJsonSchema:compactSchema(schema)},
    }),
  },fetcher,60000);
  const candidate=response.candidates?.[0];
  if(response.promptFeedback?.blockReason || !candidate) fail('Gemini did not return a usable response.',502);
  if(candidate.finishReason && candidate.finishReason!=='STOP') fail('Gemini returned an incomplete response. Retry the task.',502);
  const output=(candidate.content?.parts || []).filter(part=>!part.thought && typeof part.text==='string').map(part=>part.text).join('');
  if(!output.trim()) fail('Gemini did not return structured text.',502);
  return output;
}

export async function embedGeminiTexts({base,model,key,inputs},fetcher=fetch) {
  const resource=modelResource(model),data=[];
  for(let offset=0;offset<inputs.length;offset+=100) {
    const batch=inputs.slice(offset,offset+100);
    const response=await remoteJSON(`${apiBase(base)}/${resource}:batchEmbedContents`,{
      method:'POST',headers:headers(key),body:JSON.stringify({requests:batch.map(text=>({
        model:resource,content:{parts:[{text}]},taskType:'SEMANTIC_SIMILARITY',
      }))}),
    },fetcher,60000);
    if(!Array.isArray(response.embeddings) || response.embeddings.length!==batch.length) fail('Gemini returned an unexpected embedding count.',502);
    for(const embedding of response.embeddings) data.push({index:data.length,embedding:embedding.values});
  }
  return {data};
}
