<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref} from 'vue';
defineProps<{title:string}>();const emit=defineEmits<{close:[]}>();
const dialog=ref<HTMLDialogElement|null>(null);let previous:HTMLElement|null=null;
onMounted(()=>{
 previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
 if(dialog.value&&!dialog.value.open)dialog.value.showModal();
});
onBeforeUnmount(()=>{if(dialog.value?.open)dialog.value.close();if(previous?.isConnected)previous.focus({preventScroll:true});});
</script>
<template>
 <dialog ref="dialog" class="oracle-dialog" :aria-label="title" @cancel="emit('close')" @click.self="emit('close')">
  <div class="oracle-dialog-inner"><div class="oracle-dialog-heading"><span class="eyebrow">A FIELD GUIDE / 学习图鉴</span>
   <button type="button" class="icon-button" aria-label="关闭详情" @click="emit('close')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg></button>
  </div><slot/></div>
 </dialog>
</template>
