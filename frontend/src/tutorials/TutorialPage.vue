<script setup lang="ts">
import {computed,ref,toRef} from 'vue';
import {browserProgressStorage,tutorialsFor,useTutorialProgress,type ProgressStorage} from './progress.ts';

const props=defineProps<{actorId:string|null;storage?:ProgressStorage|null}>();
const progress=useTutorialProgress(toRef(props,'actorId'),props.storage===undefined?browserProgressStorage():props.storage);
const {completed,done,total,toggle}=progress;
const category=ref('all');
const categories=[['all','全部课程'],['tarot','塔罗入门'],['iching','易经入门'],['practice','反思与实践']] as const;
const tutorials=computed(()=>tutorialsFor(category.value));
const complete=(id:string,count:number)=>Array.from({length:count},(_,index)=>completed.value.has(id+':'+index)).every(Boolean);
</script>

<template>
 <div class="page narrow tutorials-page">
  <span class="eyebrow">LEARN / A LITTLE AT A TIME</span>
  <h1>慢慢读懂，慢慢练习。</h1>
  <p class="page-intro">从提问、看牌和认爻开始。把占卜当成整理思路的工具，让最后的决定回到你手中。</p>
  <div class="learning-progress">
   <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15"/></svg>
   <div><p>你的学习足迹 · {{ done }}/{{ total }} 步</p><progress :max="total||1" :value="done" aria-label="学习完成进度"/></div>
   <span class="muted small">本机保存</span>
  </div>
  <div class="spread-filters" aria-label="课程分类">
   <button v-for="[id,label] in categories" :key="id" type="button" :class="{active:category===id}" :aria-pressed="category===id" @click="category=id">{{ label }}</button>
  </div>
  <div class="tutorial-list">
   <article v-for="(tutorial,index) in tutorials" :key="tutorial.id" class="tutorial-card">
    <div class="tutorial-heading">
     <span class="step-number">{{ String(index+1).padStart(2,'0') }}</span>
     <div><span class="eyebrow">{{ tutorial.category==='tarot'?'TAROT':tutorial.category==='iching'?'I CHING':'PRACTICE' }}</span><h2>{{ tutorial.title }}</h2></div>
     <span v-if="complete(tutorial.id,tutorial.steps.length)" class="tutorial-complete"><span aria-hidden="true">✓</span>已完成</span>
    </div>
    <p>{{ tutorial.description }}</p>
    <ol class="tutorial-steps">
     <li v-for="(step,index) in tutorial.steps" :key="index"><label><input type="checkbox" :checked="completed.has(tutorial.id+':'+index)" @change="toggle(tutorial.id+':'+index)"/><span><strong>步骤 {{ index+1 }}</strong>{{ step }}</span></label></li>
    </ol>
   </article>
  </div>
  <div class="tutorial-footer"><h2>学一点，也试一点。</h2><p>挑一个此刻真实的问题，再把发现写进自己的生活。</p><div class="record-actions"><a class="button" href="/tarot">开始塔罗探索 <span aria-hidden="true">↗</span></a><a class="button secondary" href="/iching">尝试易经起卦</a><a class="text-link" href="/library">打开完整图鉴</a></div></div>
  <p class="disclaimer">学习进度只保存在此浏览器，不会自动上传；清除浏览器数据会清除进度。本站不教授医疗诊断或确定性的命运预测。</p>
 </div>
</template>
