<script setup lang="ts">
const id = ref('42')
const { data: hello } = await useFetch('/api/hello')
const user = await $fetch(`/api/users/${id}`)
</script>
<template>
  <div>{{ hello }} {{ user }}</div>
</template>
