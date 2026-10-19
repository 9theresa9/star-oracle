<script setup lang="ts">
import TutorialPage from './tutorials/TutorialPage.vue';
// Isolated public entry uses the existing guest namespace. The confirmed session host is not migrated yet.
</script>
<template>
 <a class="skip-link" href="#main">跳到主要内容</a>
 <header class="site-header"><a class="brand" href="/"><strong>照见</strong><span class="brand-en">STAR ORACLE</span></a><a class="text-link" href="/library">完整图鉴</a></header>
 <main id="main"><TutorialPage :actor-id="null"/></main>
</template>
