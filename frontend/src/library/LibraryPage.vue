<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref} from 'vue';
import type {TarotGuide,HexagramGuide} from '../../../packages/domain/index.js';
import {filterCards,filterHexagrams,libraryTab,tabQuery,suits,suitLabel,maskLines,type LibraryTab} from './library';
import CardArt from '../components/CardArt.vue';
import HexagramFigure from '../components/HexagramFigure.vue';
import OracleModal from '../components/OracleModal.vue';
const props=defineProps<{initialQuery?:string}>();
const query=ref(props.initialQuery??(typeof window==='undefined'?'':window.location.search));
const tab=computed(()=>libraryTab(query.value)),search=ref(''),suit=ref('all');
const tarot=ref<TarotGuide|null>(null),hex=ref<HexagramGuide|null>(null);
const cards=computed(()=>filterCards(search.value,suit.value)),hexagrams=computed(()=>filterHexagrams(search.value));
function switchTab(next:LibraryTab){
 query.value=tabQuery(query.value,next);search.value='';
 if(typeof window!=='undefined')window.history.pushState(null,'',window.location.pathname+'?'+query.value+window.location.hash);
}
const readLocation=()=>{query.value=window.location.search;};
onMounted(()=>window.addEventListener('popstate',readLocation));
onBeforeUnmount(()=>window.removeEventListener('popstate',readLocation));
</script>
<template>
 <div class="page library-page">
  <span class="eyebrow">A FIELD GUIDE / SYMBOLS &amp; CHANGE</span><h1>认识象征，也认识自己。</h1><p class="page-intro">78 张塔罗牌，64 卦。把抽象的符号，读成可以思考和实践的问题。</p>
  <div class="library-topline"><div class="segmented library-tabs" aria-label="图鉴类型">
   <button type="button" :aria-pressed="tab==='tarot'" :class="{selected:tab==='tarot'}" @click="switchTab('tarot')">塔罗 · 78 张</button>
   <button type="button" :aria-pressed="tab==='iching'" :class="{selected:tab==='iching'}" @click="switchTab('iching')">易经 · 64 卦</button>
  </div><a class="text-link" href="/vue/tutorials">▤ 从入门开始</a></div>
  <div class="library-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
   <label class="sr-only" for="library-search">搜索图鉴</label><input id="library-search" v-model="search" type="search" maxlength="100" :placeholder="tab==='tarot'?'搜索牌名、英文名或关键词':'搜索卦名、卦序、关键词或八卦'"/>
  </div>
  <div v-if="tab==='tarot'" class="spread-filters" aria-label="塔罗牌分类"><button type="button" :aria-pressed="suit==='all'" :class="{active:suit==='all'}" @click="suit='all'">全部</button>
   <button v-for="value in suits" :key="value" type="button" :aria-pressed="suit===value" :class="{active:suit===value}" @click="suit=value">{{suitLabel(value)}}</button>
  </div>
  <p class="library-result-count" role="status">找到 {{tab==='tarot'?cards.length:hexagrams.length}} 项 · 选择一项查看完整说明</p>
  <div v-if="tab==='tarot'" class="library-grid tarot-library-grid">
   <button v-for="card in cards" :key="card.id" type="button" class="library-tarot" :aria-label="'查看 '+card.name+' 的含义'" @click="tarot=card">
    <div class="library-card-art"><CardArt :id="card.id"/></div><span class="eyebrow">{{suitLabel(card.suit??'major')}}</span><h2>{{card.name}}</h2><p>{{card.upright.slice(0,3).join(' · ')}}</p><span class="library-arrow" aria-hidden="true">↗</span>
   </button>
  </div>
  <div v-else class="library-grid hex-library-grid">
   <button v-for="item in hexagrams" :key="item.number" type="button" class="library-hex" :aria-label="'查看第 '+item.number+' 卦 '+item.name" @click="hex=item">
    <HexagramFigure :lines="maskLines(item.mask)" compact :label="item.name+' 六爻'"/><span class="eyebrow">第 {{String(item.number).padStart(2,'0')}} 卦</span><h2>{{item.name}}</h2><p>{{item.theme}}</p><span class="library-arrow" aria-hidden="true">↗</span>
   </button>
  </div>
  <div v-if="tab==='tarot'&&!cards.length||tab==='iching'&&!hexagrams.length" class="empty"><h2>换一个词，再找找。</h2><p>试试牌名、卦名，或“沟通”“变化”这样的关键词。</p></div>
  <p class="disclaimer">图鉴采用现代反思式说明，不将牌意或卦意视为确定事实。牌面图案为本站原创几何线稿。</p>
  <OracleModal v-if="tarot" :title="tarot.name+' · 塔罗图鉴'" @close="tarot=null">
   <div class="library-detail-hero"><div class="library-card-art"><CardArt :id="tarot.id"/></div><div><span class="eyebrow">{{tarot.en}} · {{tarot.element}}</span><h2>{{tarot.name}}</h2><p>{{tarot.description}}</p></div></div>
   <div class="meaning-columns"><section><h3>正位 · 可以看见的力量</h3><p class="keyword-line">{{tarot.upright.join(' · ')}}</p><p>{{tarot.uprightMeaning}}</p></section><section><h3>逆位 · 值得重新照顾的部分</h3><p class="keyword-line">{{tarot.reversed.join(' · ')}}</p><p>{{tarot.reversedMeaning}}</p></section></div>
   <section class="library-detail-section"><h3>象征线索</h3><p>{{tarot.symbolism}}</p></section><div class="action-box"><h3>一个小练习</h3><p>{{tarot.practice}}</p><p class="reflection">{{tarot.reflection}}</p></div><a class="button" href="/tarot" @click="tarot=null">带着一个问题去探索 ↗</a>
  </OracleModal>
  <OracleModal v-if="hex" :title="hex.name+' · 易经图鉴'" @close="hex=null">
   <div class="library-detail-hero hex-detail-hero"><HexagramFigure :lines="maskLines(hex.mask)" compact :label="hex.name+' 六爻'"/><div><span class="eyebrow">第 {{hex.number}} 卦 · 下{{hex.lower.name}}上{{hex.upper.name}}</span><h2>{{hex.name}}</h2><p>{{hex.description}}</p></div></div>
   <p class="keyword-line">{{hex.keywords.join(' · ')}}</p><section class="library-detail-section"><h3>当下可以怎样理解</h3><p>{{hex.guidance}}</p></section><div class="action-box"><h3>给自己的一个问题</h3><p>{{hex.prompt}}</p></div><p class="muted small">这里是现代语言的学习提示，不是古籍原文。上、下卦与卦序依六爻结构列出。</p><a class="button" href="/iching" @click="hex=null">观察一次变化 ↗</a>
  </OracleModal>
 </div>
</template>
