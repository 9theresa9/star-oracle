<script setup lang="ts">
import TutorialPage from './tutorials/TutorialPage.vue';
import LibraryPage from './library/LibraryPage.vue';
const library=window.location.pathname.replace(/\/$/,'').endsWith('/library');
// Isolated public entry uses the existing guest namespace. The confirmed session host is not migrated yet.
</script>
<template>
 <a class="skip-link" href="#main">跳到主要内容</a>
 <header class="site-header"><a class="brand" href="/"><strong>照见</strong><span class="brand-en">STAR ORACLE</span></a><a class="text-link" :href="library?'/vue/tutorials':'/vue/library'">{{library?'入门教程':'完整图鉴'}}</a></header>
 <main id="main"><LibraryPage v-if="library"/><TutorialPage v-else :actor-id="null"/></main>
</template>
