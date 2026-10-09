import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
function luminance(hex){const parts=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return parts.reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const [high,low]=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(high+.05)/(low+.05);}
test('daylight text tokens meet normal-text AA on paper and the lightest sky surfaces',()=>{
 const css=readFileSync('apps/web/src/styles.css','utf8');
 for(const name of ['text','muted','gold']){const values=[...css.matchAll(new RegExp('--'+name+':(#[0-9a-f]{6})','g'))];assert.ok(values.length);const color=values.at(-1)[1];for(const bg of ['#edf5fa','#ffffff','#d1e5f0'])assert.ok(contrast(color,bg)>=4.5,`${name} ${color} on ${bg}: ${contrast(color,bg).toFixed(2)}`);}
});
