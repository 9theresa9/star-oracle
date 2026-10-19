<script setup lang="ts">
import {computed} from 'vue';
import {TAROT_DECK} from '../../../packages/domain/index.js';
const props=withDefaults(defineProps<{id:string;reversed?:boolean;back?:boolean}>(),{reversed:false,back:false});
const seed=computed(()=>Array.from(props.id).reduce((n,c)=>n+c.charCodeAt(0),0));
const petals=computed(()=>props.back?8:5+seed.value%5);
const suit=computed(()=>{
 const english=TAROT_DECK.find(card=>card.id===props.id)?.en.toLowerCase()??'';
 return english.includes('wands')?'wands':english.includes('cups')?'cups':english.includes('swords')?'swords':english.includes('pentacles')?'pentacles':'major';
});
</script>
<template>
 <svg :class="'oracle-card-art '+(reversed?'art-reversed':'')" viewBox="0 0 160 220" aria-hidden="true" focusable="false">
  <g fill="none" stroke="currentColor" stroke-width="1">
   <rect x="8" y="8" width="144" height="204" rx="8" opacity=".35"/><path d="M22 32h16M30 24v16M122 188h16M130 180v16" opacity=".6"/>
   <ellipse cx="80" cy="108" rx="48" ry="69" opacity=".3"/><circle cx="80" cy="108" r="39" opacity=".65"/>
   <path v-for="(_,index) in petals" :key="index" d="M80 64Q112 92 80 108Q48 92 80 64" :transform="'rotate('+(index*360/petals)+' 80 108)'" :opacity="back?'.42':'.7'"/>
   <template v-if="back"><circle cx="80" cy="108" r="20"/><path d="M80 88l5 15 15 5-15 5-5 15-5-15-15-5 15-5Z"/></template>
   <template v-else>
    <path :d="'M80 77L'+(102+seed%6)+' 119H'+(58-seed%6)+'Z'" fill="currentColor" fill-opacity=".08"/><circle cx="80" cy="106" r="8" fill="currentColor" fill-opacity=".22"/>
    <path v-if="suit==='wands'" d="M77 137l6-58M83 89q17-9 18-21M79 108q-17-8-19-20" stroke-width="2"/>
    <path v-else-if="suit==='cups'" d="M61 91h38v17q0 22-19 22t-19-22ZM80 130v15M65 145h30M99 95h8v11q0 12-8 12" stroke-width="2"/>
    <path v-else-if="suit==='swords'" d="M80 73l-7 14v40h14V87ZM62 127h36M80 127v24M73 151h14" stroke-width="2"/>
    <path v-else-if="suit==='pentacles'" d="M80 78l9 23h25l-20 15 8 24-22-15-22 15 8-24-20-15h25Z" stroke-width="1.6"/>
    <path d="M54 164h52M64 172h32" opacity=".5"/>
   </template>
   <circle cx="80" cy="34" r="3"/><circle cx="80" cy="185" r="2"/>
  </g>
 </svg>
</template>
