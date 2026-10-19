import test from 'node:test';
import assert from 'node:assert/strict';
import {createSSRApp} from 'vue';
import {renderToString} from '@vue/server-renderer';
import {createServer} from 'vite';
import {TAROT_LIBRARY,HEXAGRAM_LIBRARY} from '../../packages/domain/index.js';

test('actual Vue library SFC renders all78original SVG cards or64six-line hexagrams',async()=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',optimizeDeps:{noDiscovery:true,entries:[]}});
 try{
  const {default:Page}=await server.ssrLoadModule('/src/library/LibraryPage.vue');
  const tarot=await renderToString(createSSRApp(Page,{initialQuery:''}));
  assert.equal((tarot.match(/class="library-tarot"/g)??[]).length,78);assert.equal((tarot.match(/viewbox="0 0 160 220"/gi)??[]).length,78);
  for(const card of TAROT_LIBRARY)assert.ok(tarot.includes(card.name));
  const iching=await renderToString(createSSRApp(Page,{initialQuery:'tab=iching'}));
  assert.equal((iching.match(/class="library-hex"/g)??[]).length,64);assert.equal((iching.match(/class="yao /g)??[]).length,64*6);
  for(const hex of HEXAGRAM_LIBRARY)assert.ok(iching.includes(hex.name));
 }finally{await server.close();}
});
