// Persisted workspace data is JSON. Copy mutable containers while retaining
// immutable strings: structuredClone serializes every large job description
// again, multiplying the heap required by request/worker/cache snapshots.
export function cloneJsonState(value) {
  if(Array.isArray(value)) return value.map(cloneJsonState);
  if(value!==null && typeof value==='object') {
    const copy={};
    for(const key of Object.keys(value))Object.defineProperty(copy,key,{value:cloneJsonState(value[key]),enumerable:true,configurable:true,writable:true});
    return copy;
  }
  return value;
}
