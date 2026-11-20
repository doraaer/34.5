async function api(url,opts={}){const res=await fetch(url,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});const data=await res.json().catch(()=>({detail:res.statusText}));if(!res.ok)throw new Error(typeof data.detail==="string"?data.detail:JSON.stringify(data.detail));return data;}
function elt(tag,text,className=""){const e=document.createElement(tag);e.textContent=text;e.className=className;return e;}
const slots=[{start:"2026-11-23T14:00:00+01:00",end:"2026-11-23T17:00:00+01:00"},{start:"2026-11-24T09:00:00+01:00",end:"2026-11-24T12:00:00+01:00"}];
