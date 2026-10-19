import test from 'node:test';
import assert from 'node:assert/strict';
import {createSSRApp} from 'vue';
import {renderToString} from '@vue/server-renderer';
import {createServer} from 'vite';
import {TUTORIALS} from '../../packages/domain/index.js';

test('actual Vue SFC renders all canonical courses and actor-scoped stored progress',async()=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,entries:[]}});
 try{
  const {default:Page}=await server.ssrLoadModule('/src/tutorials/TutorialPage.vue');
  const id=TUTORIALS[0]!.id+':0',reads:string[]=[];
  const html=await renderToString(createSSRApp(Page,{actorId:'synthetic-actor',storage:{getItem(key:string){reads.push(key);return JSON.stringify([id]);},setItem(){throw Error('SSR must not write');}}}));
  assert.deepEqual(reads,['star-oracle-tutorials-synthetic-actor']);
  assert.equal((html.match(/class="tutorial-card"/g)??[]).length,10);
  assert.equal((html.match(/type="checkbox"/g)??[]).length,40);
  assert.equal((html.match(/ checked/g)??[]).length,1);
  assert.match(html,/1\/40/);assert.match(html,/学习完成进度/);
  for(const tutorial of TUTORIALS)assert.ok(html.includes(tutorial.title),tutorial.id);
  for(const destination of ['/tarot','/iching','/library'])assert.ok(html.includes('href="'+destination+'"'));
 }finally{await server.close();}
});
