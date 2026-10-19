<script setup lang="ts">
withDefaults(defineProps<{lines:readonly number[];revealed?:number;compact?:boolean;label?:string}>(),{revealed:6,compact:false,label:'从下到上的六爻'});
</script>
<template>
 <div :class="'hexagram '+(compact?'hex-compact':'')" :aria-label="label" role="img">
  <span class="hex-label">上</span>
  <div v-for="(value,index) in [...lines].reverse()" :key="index" :class="(compact?'aux-hex-line ':'hex-line ')+(5-index<revealed?'shown':'hidden')">
   <span :class="'yao '+(value%2?'yang':'yin')"><i/><i/></span><b>{{value===6||value===9?'◦':''}}</b>
  </div><span class="hex-label">初</span>
 </div>
</template>
